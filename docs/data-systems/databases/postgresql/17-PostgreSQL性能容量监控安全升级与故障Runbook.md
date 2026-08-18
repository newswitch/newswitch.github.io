---
title: "性能、容量、监控、安全、升级与故障 Runbook"
sidebar_label: "17. 性能、容量、监控、安全、升级与故障 Runbook"
sidebar_position: 17
description: "建立 PostgreSQL SLO、容量、监控、安全、升级和事故响应闭环。"
tags: [PostgreSQL, 性能, 容量, 安全, Runbook]
---

# 性能、容量、监控、安全、升级与故障 Runbook

> 版本基线：PostgreSQL 18.x。命令示例以 Linux 自建集群为背景；云数据库的文件、超级用户、备份和 Failover 权限以厂商边界为准。

生产运维的核心不是记参数，而是建立闭环：业务 SLO → 数据库与系统证据 → 容量/故障模型 → 有停止条件的变更 → 恢复后业务验收。

## 1. SLO：按事务类型定义 {/* #slo按事务类型定义 */}

| 类型 | 需要定义 |
| --- | --- |
| OLTP 读 | P95/P99、错误、返回行/字节、只读副本陈旧度 |
| OLTP 写 | Commit P99、TPS、死锁/序列化失败、持久化与同步复制语义 |
| 批处理/报表 | 完成时限、CPU/IO/Temp/WAL 预算、对 OLTP 的最大影响 |
| DDL/维护 | 锁等待上限、执行窗口、额外磁盘/WAL、回退点 |
| HA/DR | RPO、Failover RTO、PITR RTO、旧主 Fence 与数据校验 |

应用延迟拆为：连接池等待 + 网络/TLS + SQL 排队/锁 + 执行 + Commit/WAL/同步副本 + 返回数据。只看 `pg_stat_statements.mean_exec_time` 不能解释池耗尽或网络问题。

## 2. 容量：分开算内存、磁盘、WAL、连接和恢复 {/* #容量分开算内存磁盘wal连接和恢复 */}

```text
磁盘安全需求
= Heap + Index + TOAST + 可接受 Bloat
 + pg_wal 峰值/复制槽/归档失败
 + Temp + 日志
 + VACUUM FULL/REINDEX/pg_upgrade 等维护临时空间
 + 备份暂存与故障余量
```

数据增长要按表/索引/TOAST 分解，结合保留期和分区淘汰。WAL 容量按写入峰值、Checkpoint、Slot 最大中断时间和归档修复时间测算；一个失活逻辑 Slot 就可能让 `pg_wal` 持续增长。

内存不是 `shared_buffers + max_connections × work_mem` 的简单固定分配。`work_mem` 可被一个查询的多个 Sort/Hash 节点、并行 Worker 和多个活跃 Session 分别使用；还要加 `maintenance_work_mem`、Autovacuum、WAL、连接 Backend、扩展、OS Page Cache 和容器余量。

```text
并发内存峰值
≈ shared_buffers
 + 活跃查询数 × 每查询并发内存节点 × work_mem
 + 并行 Worker/维护/Autovacuum
 + Backend/Extension/OS
```

连接数用连接池限制活跃并发。几千个 Idle Backend 也占进程与内存，几千个同时 Active 更会把 CPU、Lock 和 I/O 排队打满。池大小由数据库可持续并发和业务队列时限决定，不是“实例越大连接越多”。

恢复容量要实测：下载/读取备份、Base Restore、WAL Replay、启动、统计/缓存恢复、业务校验各耗时。快照大小除以磁盘吞吐只能估算其中一段。

## 3. 压测：把维护和故障放进测试 {/* #压测把维护和故障放进测试 */}

使用真实数据规模/倾斜、行宽、索引、事务、连接池、Prepared Statement 和 TLS。分别测冷/热 Cache、稳定负载、峰值、过载；同时覆盖 Checkpoint、Autovacuum、备份、Slot 消费变慢、同步副本延迟和 Failover。

每档持续到 Checkpoint/Vacuum 周期出现，报告吞吐、P50/P95/P99/P999、池等待、错误、Wait Event、Top SQL、IO/WAL、Temp、复制与系统指标。以“少一个副本/节点后仍满足 SLO”确定安全容量。

## 4. 监控地图与取证 SQL {/* #监控地图与取证-sql */}

```text
application → pool wait, tx latency, retries
sessions    → pg_stat_activity, waits, xact age
SQL         → pg_stat_statements, plans, temp, WAL
storage     → relation growth, bloat, pg_stat_io, checkpointer
replication → LSN lag, slots, conflicts
system      → CPU, RSS, cache, disk latency, network
```

### 4.1 Session、等待与阻塞 {/* #session等待与阻塞 */}

```sql
SELECT pid, usename, application_name, client_addr,
       state, xact_start, query_start,
       wait_event_type, wait_event,
       pg_blocking_pids(pid) AS blocking_pids,
       left(query, 200) AS query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
ORDER BY xact_start NULLS LAST, query_start NULLS LAST;
```

`state='active'` 且 Wait Event 非空表示查询正在执行但等待某资源。`ClientRead` 常表示数据库在等客户端下一条消息，不等于数据库自身慢；Lock/LWLock/IO/IPC 要继续定位对应资源。

结束 Session 前先确认 Blocking Tree、事务内容和 Owner：`pg_cancel_backend` 只取消当前 Query，`pg_terminate_backend` 结束连接并回滚事务。批量 Kill 可能触发重试风暴和更长回滚。

### 4.2 Top SQL {/* #top-sql */}

```sql
SELECT queryid, calls, rows,
       total_exec_time, mean_exec_time,
       shared_blks_hit, shared_blks_read,
       temp_blks_written, wal_bytes,
       left(query, 300) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

按总耗时找资源大户，按 Mean/P99 找单次慢查询，按 Calls 找高频小 SQL。统计是累计值且可能重置；监控要取 Delta。对具体 SQL 使用 `EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)`，写语句必须在安全环境评估真实副作用。

### 4.3 I/O、WAL 与 Checkpoint {/* #iowal-与-checkpoint */}

PostgreSQL 18 使用 `pg_stat_io` 区分 Backend Type、Object 和 Context 的 Read/Write/Extend/Fsync，配合 `pg_stat_wal`、`pg_stat_checkpointer`、OS `iostat` 看完整链路。数据库统计无法区分 OS Page Cache 的命中，不能脱离主机指标解释。

启用 `track_io_timing`/`track_wal_io_timing` 会有平台相关开销，先在目标环境评估。关注 Checkpoint 请求/时间/写量、WAL 生成率、Temp 文件、DataFileRead/Extend 和 Fsync 尾延迟。

### 4.4 复制与 Slot {/* #复制与-slot */}

```sql
SELECT application_name, client_addr, state, sync_state,
       sent_lsn, write_lsn, flush_lsn, replay_lsn,
       write_lag, flush_lag, replay_lag
FROM pg_stat_replication;

SELECT slot_name, slot_type, active, active_pid,
       restart_lsn, confirmed_flush_lsn,
       wal_status, safe_wal_size
FROM pg_replication_slots;
```

Lag 既看字节也看时间与阶段：Receive、Write、Flush、Replay。逻辑 Slot 的 `confirmed_flush_lsn` 代表消费确认，`restart_lsn` 影响 WAL 保留；物理副本 Query 冲突还要看 `pg_stat_database_conflicts`。

## 5. 告警设计 {/* #告警设计 */}

业务告警：连接池排队/超时、事务 P99、错误与重试。数据库告警：连接/Active、长事务、Lock Tree、Deadlock、Top SQL 回归、Temp/WAL、Checkpoint、Autovacuum/XID、磁盘与归档、复制 Lag/Slot、备份恢复结果。系统告警：CPU steal/throttle、内存/Swap/OOM、磁盘延迟/空间/inode、网络重传与时钟。

阈值要能换算成时间。例如 `pg_wal` 剩余空间 ÷ 当前 WAL bytes/s = 距离磁盘满的时间，比固定百分比更可行动。

## 6. 安全 {/* #安全 */}

数据库只暴露私网，`listen_addresses` 与防火墙控制监听面，`pg_hba.conf` 按来源、数据库、用户和认证方式最小允许。新系统优先 SCRAM-SHA-256、TLS 与证书校验；凭据放 Secret Manager，连接串/日志不写密码。

Role 分层：Login Role、Owner Role、Read/Write Role、Migration Role、Monitoring Role 分离；应用不拥有 Schema/表，不是 Superuser，不具有 `CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS`。撤销 Public Schema 的不必要 CREATE，固定安全 `search_path`，Security Definer Function 显式设置 Search Path 并检查动态 SQL。

扩展 C 代码运行在数据库进程权限内，只有受信来源和明确版本可安装；`shared_preload_libraries`、OS 文件访问和高危内置 Role 单独审批。审计登录失败、Role/Grant、DDL、扩展、配置、备份恢复和 HA 操作；SQL/参数日志按隐私脱敏。

备份、WAL Archive 和复制链路同样加密、最小权限、不可变保留和访问审计。生产数据脱敏后才能进入测试环境。

## 7. 备份与恢复验收 {/* #备份与恢复验收 */}

| 方法 | 用途 | 验收重点 |
| --- | --- | --- |
| `pg_dump`/`pg_dumpall` | 逻辑对象、选择性迁移、跨版本 | 全局 Role/Tablespace、Extension、Owner、恢复时间 |
| Base Backup + WAL Archive | 整集群与 PITR | WAL 连续、Timeline、Recovery Target、归档恢复速度 |
| 存储快照 | 快速基础副本 | 必须满足 PostgreSQL 一致性协议并包含所有 Tablespace/WAL |
| Replica | HA 与读扩展 | 不是误删/勒索备份 |

备份任务成功只证明生成了文件。定期从异地恢复到隔离环境，验证 Checksum/日志、数据库/Role/Extension、行数与业务不变量、PITR 目标前后边界、RPO/RTO。恢复后的统计可能重置或过期，放流前评估 Analyze、Cache Warmup 和 Plan 变化。

## 8. 升级 {/* #升级 */}

PostgreSQL 小版本不改变同一 Major 的内部存储格式，通常停库替换二进制再启动；HA 发行版/云服务仍应按对应流程滚动和 Failover。大版本可能改变 Catalog、SQL 行为和 C API，有三条主要路径：

| 路径 | 停机/速度 | 优点 | 主要风险 |
| --- | --- | --- | --- |
| Dump/Restore | 慢，数据越大越久 | 最干净、可重建对象 | 长停机、恢复顺序和全局对象 |
| `pg_upgrade` | 通常分钟级 Catalog 转换 | 大数据快 | Extension/二进制兼容、磁盘模式、停机切换 |
| 逻辑复制 | 可把切换降到较短 | 新旧并行验证 | DDL/Sequence/Large Object、复制冲突和切回复杂 |

`pg_upgrade --check` 先验证；目标版本的 Extension `.so` 必须提前安装。默认 Copy 保留旧数据；`--link` 快但新集群启动后旧集群不能安全回退；文件系统支持时 `--clone` 可获得 Reflink 速度且保持旧集群不被修改。无论哪种模式，都要核对 Tablespace、Collation、Encoding、Extension、统计、订阅/Slot 和 HA 副本重建。

升级前回放真实 SQL、驱动和迁移，阅读所有跨越版本 Release Notes 的 Migration 部分。切换后验证业务、Plan、复制、备份、归档和监控，再过回滚点；不能只看 `SELECT version()`。

## 9. Runbook {/* #runbook */}

### 9.1 P99 高、CPU 低 {/* #p99-高cpu-低 */}

```text
应用 pool wait/网络
→ pg_stat_activity Wait Event
→ Blocking Tree/长事务
→ Top SQL 与 Plan
→ IO/Checkpoint/WAL fsync/同步副本
→ OS/存储/网络
```

CPU 低可能是在等 Lock、I/O、同步副本或客户端。先限制重试/批任务，保存活动 Session、Wait、Top SQL 和系统时间线，不先重启数据库。

### 9.2 磁盘快速增长 {/* #磁盘快速增长 */}

分别统计 Relation、`pg_wal`、Temp、Log、Archive Staging 和备份。`pg_wal` 增长继续查失活 Slot、归档失败、长备份、Checkpoint/WAL 速率；Relation 增长查业务写入/Bloat；Temp 查 Top SQL。不要手工删除 `pg_wal`，不要在不清楚 Owner 时删 Slot。

### 9.3 Replica Lag {/* #replica-lag */}

按 Receive → Write → Flush → Replay 分层。Receive 慢查网络/Primary WAL Sender；Write/Flush 慢查 Standby 磁盘；Replay 慢查 Recovery I/O、冲突和长查询。先保证 WAL 不丢和 Primary 空间，再决定取消 Standby Query、扩资源或重建副本。

### 9.4 Corruption {/* #corruption */}

停止扩大影响，隔离可疑节点并保留日志、Core、Checksum/页面、存储事件和备份。不要对唯一副本直接运行破坏性修复。判断是单页、单 Relation、WAL、文件系统还是内存/硬件，优先从健康副本/备份恢复并进行业务校验；修复后还要处理底层硬件根因。

### 9.5 Failover {/* #failover */}

```text
确认 Primary 不可用/分区
→ Fence 旧主写入
→ 选择 LSN 最新且满足策略的 Standby
→ Promote 并产生新 Timeline
→ 切路由与验证写入
→ 旧主以新 Primary 的副本重建
```

没有 Fence 就可能双主。恢复不仅看新主可连接，还要校验 Timeline、关键事务、Sequence、应用连接池、Slot/订阅、备份归档和旧主不再接受写。

## 10. 事故关闭标准 {/* #事故关闭标准 */}

根因由跨层证据确认；临时限流/参数与永久修复分开；数据一致性、复制、归档和备份恢复通过；业务 SLO 恢复；所有临时权限/开关回收；Runbook 和演练新增了本次故障路径。

## 11. 验收题 {/* #验收题 */}

- CPU 低而 P99 高时最先查什么？
- WAL、Slot、Temp 分别怎样填满磁盘？
- 大版本升级有哪些迁移方式？
- 恢复后怎样证明业务数据正确？
- `work_mem` 为什么不能简单乘 `max_connections`，也不能随意全局调大？
- Failover 为什么必须先 Fence 旧主？

## 12. 参考资料 {/* #参考资料 */}

- [Monitoring](https://www.postgresql.org/docs/18/monitoring.html)
- [Upgrading](https://www.postgresql.org/docs/18/upgrading.html)
- [Backup and Restore](https://www.postgresql.org/docs/18/backup.html)
- [Continuous Archiving and PITR](https://www.postgresql.org/docs/18/continuous-archiving.html)
- [pg_upgrade](https://www.postgresql.org/docs/18/pgupgrade.html)
