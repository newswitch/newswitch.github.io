---
title: "pgBackRest、WAL-G、Patroni 与跨集群 PITR"
sidebar_label: "19. pgBackRest、WAL-G、Patroni 与跨集群 PITR"
sidebar_position: 19
description: "深入 PostgreSQL 生产备份工具链，说明 pgBackRest、WAL-G、Patroni、WAL 归档、跨集群恢复、时间线和恢复验证怎样协同。"
tags: [PostgreSQL, pgBackRest, WAL-G, Patroni, PITR, 灾难恢复]
---

# pgBackRest、WAL-G、Patroni 与跨集群 PITR

基础文章已经说明 Base Backup、WAL Archive 和 PITR 的原理。本章进一步回答生产环境真正困难的问题：备份链由谁管理，主备切换后怎样继续归档，恢复到另一套 Patroni 集群时怎样避免双主，以及如何证明某个恢复点真的可用。

## 1. 先明确 PostgreSQL 的可恢复闭包

一次可恢复的物理备份不是一个压缩包，而是一组互相依赖的状态：

~~~text
一致的 Base Backup
  + 让该 Base Backup 达到一致状态所需的 WAL
  + 从备份结束点到目标时间连续不断的 WAL
  + backup manifest、版本、校验和与加密密钥
  + tablespace 映射、扩展、配置和外部依赖
= 可以启动并回放到目标点的 PostgreSQL 集群
~~~

Base Backup 中的数据页可能来自不同时间。恢复时 PostgreSQL 依靠 WAL 重放把它们推进到一致状态，因此“备份文件上传完成”不等于“恢复闭包完整”。归档缺一个 WAL Segment，PITR 就会在缺口处停止。

## 2. pgBackRest 与 WAL-G 怎样选择

| 维度 | pgBackRest | WAL-G |
| --- | --- | --- |
| 主要定位 | PostgreSQL 专用的备份、归档和恢复套件 | 面向对象存储的多数据库归档恢复工具 |
| 备份类型 | Full、Differential、Incremental | Full、Delta |
| 仓库 | POSIX、S3 等，多仓库能力成熟 | S3/GCS/Azure 等云对象存储路径直接 |
| 校验与清单 | 备份清单、校验、info/check 命令完整 | Sentinel 元数据、备份列表和对象校验 |
| 归档 | archive-push/archive-get，可异步 | wal-push/wal-fetch，也支持常驻 daemon |
| 恢复链 | 工具解析 Full/Diff/Incr 依赖 | 自动组合 Full/Delta，再取 WAL |
| 常见场景 | 自建 PostgreSQL、严格仓库治理 | 云原生、对象存储、容器化环境 |

二者都能完成生产级方案。不要在同一实例上让两套工具同时接管 archive_command；否则重复上传、退出码和保留策略会互相干扰。选型后应由一套工具成为 WAL 归档的唯一责任方。

## 3. pgBackRest 生产链路

### 3.1 Stanza 是什么

Stanza 表示一套 PostgreSQL 集群及其仓库配置。它把 PGDATA、端口、仓库、加密和保留策略放进同一管理边界。

~~~ini
[prod]
pg1-path=/var/lib/postgresql/18/main
pg1-port=5432

[global]
repo1-type=s3
repo1-s3-endpoint=s3.example.internal
repo1-s3-bucket=pg-backup
repo1-path=/prod/postgresql
repo1-retention-full=4
repo1-retention-diff=7
repo1-cipher-type=aes-256-cbc
process-max=8
start-fast=y
~~~

密钥不应直接进入镜像、Git 或命令历史，应通过 Secret 文件、KMS 或受控注入提供。

初始化并检查：

~~~bash
pgbackrest --stanza=prod stanza-create
pgbackrest --stanza=prod check
pgbackrest --stanza=prod info
~~~

check 不只检查网络连通，还会验证 PostgreSQL 与仓库归档链路。它应纳入周期巡检。

### 3.2 让 WAL 归档成为提交路径的一部分

~~~ini
archive_mode=on
archive_command='pgbackrest --stanza=prod archive-push %p'
archive_timeout=60s
~~~

archive_command 退出码为 0 后，PostgreSQL 才认为该 WAL 已安全归档。连续失败会让 pg_wal 堆积并最终撑满数据盘，因此必须监控：

- pg_stat_archiver 中 failed_count、last_failed_time；
- pg_wal 目录增长速度和剩余空间；
- 仓库端最后一个 WAL 的时间、Timeline 和连续性；
- archive-push 延迟与对象存储错误。

### 3.3 Full、Diff 与 Incr 不是越细越好

~~~text
周日 Full
周一到周六 Diff
每 6 小时 Incr
WAL 持续归档
~~~

Differential 只依赖最近 Full；Incremental 依赖它之前的 Full、Diff 和 Incremental 链。增量更省空间，但链越长，恢复要读取的对象越多，任一依赖损坏都可能阻断恢复。

恢复时间可以粗略拆成：

~~~text
RTO ≈ 环境准备
    + 备份对象下载
    + 解压与文件还原
    + WAL 获取和重放
    + 数据校验
    + 应用切换
~~~

因此备份频率应由 RPO 决定，而 Full/Diff/Incr 组合还要由目标 RTO 和对象存储吞吐决定。

执行备份：

~~~bash
pgbackrest --stanza=prod --type=full backup
pgbackrest --stanza=prod --type=diff backup
pgbackrest --stanza=prod --type=incr backup
pgbackrest --stanza=prod info
~~~

### 3.4 保留策略必须保护整条依赖链

pgBackRest 在 Full 过期时会一并处理依赖它的 Diff/Incr，并保留让有效备份达到一致状态所需的 WAL。若额外配置更激进的 archive retention，需要先 dry-run 并证明目标 PITR 窗口没有被截断。

不能只写“保留 30 天”，还要明确：

| 对象 | 规则 |
| --- | --- |
| Base Backup | 保留多少个 Full，以及其依赖备份 |
| WAL | 至少覆盖最老可恢复 Base 到当前的连续区间 |
| 月度归档 | 标记长期保留，避免被日常 expire 清理 |
| 异地副本 | 与主仓库使用独立账号、密钥和删除权限 |
| 失败上传 | 定期识别不完整对象，但不能手工改仓库目录 |

## 4. WAL-G 生产链路

WAL-G 把压缩、并发上传、Delta 和对象存储作为核心能力：

~~~ini
archive_mode=on
archive_command='wal-g wal-push %p'
restore_command='wal-g wal-fetch %f %p'
~~~

创建与查看备份：

~~~bash
wal-g backup-push /var/lib/postgresql/18/main
wal-g backup-list --pretty --detail
~~~

恢复到空目录：

~~~bash
wal-g backup-fetch /var/lib/postgresql/18/restore LATEST
~~~

Delta 恢复会自动取得基础备份与中间 Delta，但数据库达到一致状态仍需要相应 WAL。限制 Delta 链长度可避免恢复路径无限增长。

持续高 WAL 流量下，每个 WAL 都启动新进程会产生额外开销。WAL-G daemon 或 PostgreSQL 15+ 的 archive_library 集成可以缩短这条热路径，但引入常驻进程后要监控 socket、队列、超时和进程存活。

删除备份前先查看依赖：

~~~bash
wal-g backup-list --pretty --detail
wal-g delete retain FULL 5 --use-sentinel-time --confirm
~~~

删除动作应由备份平台统一执行，不允许值班人员直接删除对象前缀。对象锁或跨账号副本负责抵御误删和凭据失陷。

## 5. Patroni 与备份工具怎样协同

Patroni 负责 PostgreSQL 节点角色与故障转移，不负责替代备份。两者的交点是“谁在归档、从谁做备份、故障转移后怎样连续”。

### 5.1 可以从 Standby 做备份吗

可以减轻 Primary 的读盘和网络压力，但要验证：

- Standby 是否持续接收并回放 WAL；
- 备份期间是否发生提升或 Timeline 切换；
- 工具是否支持从 Standby 备份以及版本限制；
- 归档责任仍由当前 Primary 明确承担；
- Standby 上 checkpoint/restartpoint 对备份时长的影响。

不要把“从备库备份”理解为“备库目录直接复制”。物理复制目录在运行中也会变化，仍必须通过 PostgreSQL 支持的备份协议和工具完成一致性封装。

### 5.2 Failover 后最容易断在哪里

~~~text
旧 Primary：Timeline 1
      ↓ 故障转移
新 Primary：创建 Timeline 2，继续产生 WAL
      ↓
归档仓库必须同时保存 history 文件与新 Timeline WAL
~~~

需要验证新主的 archive_command 已启用、凭据有效、仓库路径相同且不会覆盖不同内容。旧主必须 fencing，在 rewind 或重建前不能重新接受写入。

Patroni 配置中的 create_replica_methods 可调用 pgBackRest/WAL-G，从仓库恢复新副本；大库场景下这通常比从 Primary 在线拉完整 Base Backup 更可控。具体脚本必须把失败退出码返回 Patroni，不能“日志报错但脚本返回成功”。

## 6. 跨集群 PITR 的标准流程

目标不是在原集群上覆盖恢复，而是在隔离环境创建一套新集群。

### 6.1 恢复前冻结事实

记录：

- 事故时间窗和时区；
- 目标事务时间、LSN 或命名 Restore Point；
- 当前与历史 Timeline；
- PostgreSQL 大版本、扩展和 collation 版本；
- 备份标签、仓库、WAL 连续区间和校验结果；
- 原集群是否仍在写入，是否需要先阻止错误扩散。

### 6.2 只恢复一个节点

先准备与源端兼容的 PostgreSQL 二进制、扩展、操作系统用户和 tablespace 路径。目标 PGDATA 必须为空或由工具明确管理。

pgBackRest 时间点恢复示例：

~~~bash
pgbackrest --stanza=prod +  --type=time +  --target="2026-09-08 01:24:30+08" +  --target-action=promote +  --pg1-path=/var/lib/postgresql/18/restore +  restore
~~~

WAL-G 恢复则先 backup-fetch，再在 PostgreSQL 恢复配置中设置 restore_command、recovery_target_time 和 recovery_target_action。

不要一开始就同时启动三个 Patroni 节点。先让单节点完成 WAL 重放并提升，验证数据后，再以它为唯一源重建其他副本；否则多个节点可能同时尝试初始化、争抢 DCS 或从错误源复制。

### 6.3 使用新的 DCS Namespace

灾备集群应使用独立的 Patroni scope、etcd/Consul 路径和接入地址：

~~~text
原集群 scope: orders-prod
恢复集群 scope: orders-recovery-20260908
~~~

复用原 scope 可能让恢复节点与生产节点互相识别，带来错误选主。DNS、VIP、HAProxy 和连接池也先指向隔离地址，业务切换必须是最后一步。

### 6.4 判断何时停止 WAL 重放

时间点不是天然精确的业务边界：

- 数据库时间使用哪一时区；
- 应用日志时间是否与数据库时钟一致；
- 一个事务的多条修改在提交时一起可见；
- DDL、Sequence 和外部系统副作用是否同步；
- 目标时刻之前是否已写入坏数据。

更可靠的方法是在危险操作前创建命名 Restore Point：

~~~sql
SELECT pg_create_restore_point('before_orders_migration_20260908');
~~~

恢复时以 Restore Point 为目标，比根据人工日志猜测秒级时间更稳定。

## 7. 恢复验收不能只看数据库启动

### 7.1 物理层

~~~bash
pg_controldata /var/lib/postgresql/18/restore
pg_checksums --check -D /var/lib/postgresql/18/restore
~~~

检查启动日志中是否存在缺 WAL、校验失败、Timeline 不匹配和 tablespace 缺失。pg_verifybackup 可以核验原生 pg_basebackup 的 manifest，但官方也明确说明它不能替代测试恢复。

### 7.2 数据库层

~~~sql
SELECT pg_is_in_recovery();
SELECT pg_current_wal_lsn();
SELECT datname FROM pg_database ORDER BY 1;
SELECT extname, extversion FROM pg_extension ORDER BY 1;
SELECT count(*) FROM orders WHERE created_at >= now() - interval '1 day';
~~~

校验对象数、关键表行数、约束、索引、Sequence、扩展和最近业务数据。超大表使用分层抽样或业务汇总，不要为了验收执行无边界 count。

### 7.3 业务层

选择一组不可变业务 ID，对比订单状态、金额、审计记录和关联关系；在隔离账号下执行读写冒烟，再验证事务、连接池和权限。若系统还依赖对象存储、消息队列或搜索索引，需要以数据库恢复点为基准决定重放或重建范围。

## 8. 监控与告警

| 信号 | 说明 | 处置方向 |
| --- | --- | --- |
| archived_count 长期不增 | 没有 WAL 或归档停止 | 对照写入量和 last_archived_wal |
| failed_count 增长 | archive_command 失败 | 查凭据、DNS、仓库、超时与退出码 |
| pg_wal 快速增长 | WAL 无法回收 | 检查归档与复制 Slot |
| 最后成功备份超龄 | RTO 风险增大 | 查调度器、锁、I/O 和仓库 |
| WAL 缺口 | PITR 窗口中断 | 立即保护现有对象并确认可恢复上界 |
| Restore 演练超时 | 实际 RTO 不达标 | 调并发、链长、网络和预置容量 |

告警应同时覆盖“任务是否成功”和“产物是否可恢复”。只有前者会把大量失败隐藏在绿色调度状态后面。

## 9. 常见错误与定位

### 9.1 恢复报 requested WAL segment has already been removed

先确认缺失 WAL 属于哪个 Timeline、是否曾成功上传、是否被保留策略过早删除。不要反复重启恢复实例；重启不会补回归档缺口。

### 9.2 备份成功但仓库增长异常

检查全量/增量类型是否符合计划、数据文件是否频繁变化、压缩和 bundle/block 选项、对象存储版本控制，以及失败备份残留。先用工具的 info/list/expire dry-run 分析，禁止手工删除仓库内部文件。

### 9.3 PITR 到达时间点但数据不对

核对时区、提交时间而非语句开始时间、目标 Timeline、target inclusive 语义和应用事件时间。若坏操作跨越多个数据库或外部系统，单库 PITR 无法自动恢复分布式一致性。

## 10. 一套可执行的生产策略

~~~text
每周 Full + 每日 Diff + 每 6 小时 Incr
WAL 持续归档，按 5 分钟内归档完成告警
主仓库跨账号不可变保存 35 天
月度 Full 复制到第二地域并长期保留
每周自动恢复最新备份到隔离实例
每季度执行 Patroni 跨集群 PITR 与应用切换演练
~~~

频率只是示例。最终参数由业务 RPO/RTO、WAL 产生速率、数据库大小、网络带宽和恢复测试决定。

## 11. 复盘题与答案

### 11.1 为什么 Patroni 三节点正常不代表可以删除备份

复制与故障转移会把误删、错误更新和部分逻辑损坏同步到副本；备份保存的是独立历史恢复点，二者解决的故障不同。

### 11.2 为什么 WAL 全在，但没有 Base Backup 仍不构成常规 PITR

WAL 描述从某个数据库状态开始的变化，不是完整数据集。恢复需要一个可识别的基础状态，再连续重放之后的 WAL。

### 11.3 为什么恢复演练必须使用新的 Patroni scope

Patroni 通过 DCS scope 识别同一集群成员。复用生产 scope 会让恢复节点参与生产选主，破坏隔离边界。

### 11.4 增量备份越频繁，RTO 一定越短吗

不一定。它可能缩小备份量，却增加依赖链和小对象读取。RTO 要以完整恢复计时验证。

## 12. 延伸阅读

- [数据库可靠性与备份恢复学习路线](../../database-reliability/00-数据库可靠性与备份恢复学习路线.md)
- [PostgreSQL Backup and Restore](https://www.postgresql.org/docs/18/backup.html)
- [Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [pg_verifybackup](https://www.postgresql.org/docs/18/app-pgverifybackup.html)
- [pgBackRest User Guide](https://pgbackrest.org/user-guide.html)
- [pgBackRest Command Reference](https://pgbackrest.org/command.html)
- [WAL-G PostgreSQL Documentation](https://github.com/wal-g/wal-g/blob/master/docs/PostgreSQL.md)

生产级 PostgreSQL 备份的完成标志不是仓库里出现了文件，而是能够从独立故障域取回完整备份链，在隔离集群回放到指定业务边界，并在目标 RTO 内通过数据和应用验收。
