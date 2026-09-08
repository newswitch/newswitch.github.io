---
title: "Redis RDB、AOF、Sentinel 与 Cluster 完整恢复专项"
sidebar_label: "15. Redis 持久化备份与 Cluster 恢复专项"
sidebar_position: 15
description: "从 Redis 数据价值分类出发，深入 RDB、多段 AOF、Sentinel、Cluster 分片备份、隔离恢复、TTL 校验与生产演练。"
tags: [Redis, RDB, AOF, Sentinel, Cluster, 备份恢复]
---

# Redis RDB、AOF、Sentinel 与 Cluster 完整恢复专项

Redis 既可能是可随时重建的缓存，也可能保存会话、限流状态、排行榜、任务状态甚至业务主数据。恢复方案必须先回答“这些 Key 丢失后由谁重建”，再讨论 RDB、AOF 和副本。

## 1. 先给 Redis 数据分类

| 类型 | 例子 | 恢复策略 |
| --- | --- | --- |
| 可重建缓存 | 商品详情、配置查询缓存 | 保护源数据库，允许冷启动重建 |
| 短期状态 | Session、验证码、限流窗口 | 接受明确 RPO，重点保留 TTL 语义 |
| 派生结果 | 排行榜、计数聚合 | 从事件流或数据库重放 |
| 唯一状态 | 没有其他来源的业务 Key | 必须按数据库标准做持久化、备份和恢复 |

若最后一类数据存在，就不能把“Redis 本来就是缓存”当恢复方案。

## 2. Redis 的四个数据时间点

~~~text
客户端收到 OK
  → 命令已修改主节点内存
  → 副本收到并应用
  → AOF 写入操作系统 Page Cache
  → AOF fsync 到稳定介质
  → 下一次 RDB 快照包含该变化
~~~

这些时间点并不相等。appendfsync everysec 常见情况下把 AOF 刷盘损失窗口控制在秒级，但进程、内核、存储和配置异常仍决定真实 RPO；RDB 的 RPO 通常等于两次成功快照之间的间隔。

## 3. RDB：一个时间点的完整数据集

RDB 适合离线归档、快速加载和跨地域复制。Redis 通过子进程生成临时文件，完成后原子替换最终 RDB，因此应复制已经完成的最终文件，而不是正在写入的临时文件。

### 3.1 生成和确认

~~~bash
redis-cli BGSAVE
redis-cli INFO persistence
redis-cli LASTSAVE
redis-cli CONFIG GET dir
redis-cli CONFIG GET dbfilename
~~~

重点字段：

| 字段 | 含义 |
| --- | --- |
| rdb_bgsave_in_progress | 当前是否正在生成 |
| rdb_last_bgsave_status | 最近一次是否成功 |
| rdb_last_save_time | 最近成功时间 |
| rdb_last_cow_size | fork 后 COW 额外内存 |
| rdb_changes_since_last_save | 快照后未包含的写入量 |

备份侧只在 rdb_bgsave_in_progress=0 且最近状态为 ok 时复制 dump.rdb，并记录 LASTSAVE、Redis 版本和文件校验和。

### 3.2 从副本生成 RDB

从副本做 BGSAVE 可以降低主节点 fork 和读盘压力，但必须记录复制偏移与延迟。一个落后 10 分钟的副本生成的“刚完成备份”，其数据恢复点仍落后 10 分钟。

~~~bash
redis-cli INFO replication
redis-cli INFO persistence
~~~

检查 master_link_status、master_last_io_seconds_ago、master_repl_offset 与 slave_repl_offset。备份开始前后都要记录，避免在复制断开期间得到陈旧快照。

## 4. AOF：命令历史与多段文件

Redis 7 以后，AOF 通常是一个目录内的多段结构：

~~~text
appendonlydir/
├── appendonly.aof.1.base.rdb
├── appendonly.aof.1.incr.aof
└── appendonly.aof.manifest
~~~

Base 保存重写后的基础数据，Incr 保存之后的变化，Manifest 定义加载顺序。只复制某个 aof 文件会丢掉恢复依赖。

### 4.1 安全复制 AOF

在常规外部备份中：

1. 暂停自动 AOF Rewrite；
2. 等待 aof_rewrite_in_progress 变为 0；
3. 原子地复制整个 appenddirname；
4. 对目录清单和每个文件计算校验和；
5. 恢复原有 rewrite 策略。

~~~bash
redis-cli INFO persistence
redis-cli CONFIG GET appenddirname
redis-cli CONFIG GET appendonly
redis-cli CONFIG GET appendfsync
~~~

不要在 Rewrite 正在切换 Base、Incr 和 Manifest 时逐文件复制，否则得到的组合可能从未同时存在过。

Redis 8.10 及以后若目标版本支持 BACKUP 命令族，可用 BACKUP START、BACKUP SEAL 和 BACKUP CLEANUP 创建封存的多段 AOF 恢复集；上线前必须以实际 COMMAND DOCS 和目标补丁版本验证，不能把新版本命令直接写进旧集群自动化。

### 4.2 AOF 损坏怎样处理

先复制原始文件到隔离目录，再检查：

~~~bash
redis-check-aof appendonlydir/appendonly.aof.manifest
redis-check-rdb dump.rdb
~~~

带 --fix 的修复可能截断损坏尾部并丢失数据，不能直接作用于唯一原件。修复后的数据必须与业务基准、Key 数、关键值和 TTL 一起校验。

## 5. 同时开启 RDB 与 AOF 时恢复谁

当 RDB 和 AOF 同时开启，Redis 重启通常优先加载 AOF，因为它往往更新。RDB 仍有价值：

- 提供独立、紧凑的周期恢复点；
- AOF 损坏时作为较早的保底；
- 适合长期归档和快速传输；
- 可对比 AOF 恢复结果。

因此“同时开启”不是两份等价实时副本，而是两条 RPO、性能和故障特征不同的恢复路径。

## 6. Sentinel 环境备份与恢复

Sentinel 保存监控与故障转移配置，不保存业务数据。数据备份仍来自 Redis 主从节点。

### 6.1 备份时记录

- 当前 Master 地址和 run_id；
- 所有 Replica 的复制偏移和健康；
- Sentinel quorum、down-after-milliseconds、failover-timeout；
- redis.conf、ACL、TLS 证书引用和模块版本；
- RDB/AOF 产物与校验和。

### 6.2 隔离恢复顺序

~~~text
恢复一个 Redis 节点
  → 验证数据、TTL、ACL 和模块
  → 以该节点作为新 Master
  → 从它重建 Replica
  → 新建或重新配置 Sentinel
  → 客户端切到新的 Sentinel 服务名
~~~

不要让恢复节点在验收前加入旧 Sentinel 监控范围。旧 Master 若仍存活，也必须隔离，避免客户端在两套主之间写入。

## 7. Redis Cluster 为什么更难备份

Cluster 把 16384 个 Slot 分布到多个 Master。完整恢复点至少包含：

~~~text
每个 Master 的 RDB/AOF
  + 每份产物对应的复制偏移和生成时间
  + Slot → Node 映射
  + Cluster ID、node ID 和拓扑记录
  + ACL、TLS、模块、配置与版本
~~~

逐节点 BGSAVE 并不会自动形成全局事务一致快照。不同 Master 的快照可能相差几十秒，而跨 Slot 操作、应用工作流和异步事件仍在发生。

### 7.1 怎样收敛一致性窗口

按业务要求从低到高选择：

1. 接受一个有界时间窗，记录每个分片的快照时间和偏移；
2. 在应用层短暂停写，等待复制追平，再并行触发所有 Master 快照；
3. 让唯一业务事实保存在事务数据库或事件日志，Redis 恢复后可重建；
4. 对强一致跨分片状态重新审视数据模型，不把它只放在 Redis Cluster。

Redis Cluster 没有跨所有分片的全局快照事务，运维脚本不能伪造这个保证。

### 7.2 Cluster 备份清单

~~~bash
redis-cli --cluster check redis-0.redis:6379
redis-cli -h redis-0.redis CLUSTER SHARDS
redis-cli -h redis-0.redis CLUSTER INFO
redis-cli -h redis-0.redis INFO replication
redis-cli -h redis-0.redis INFO persistence
~~~

对每个 Master 生成产物，并把 node_id、角色、Slot 范围、master_replid、master_repl_offset、LASTSAVE、文件哈希写入同一个外部 manifest。

## 8. Cluster 完整恢复流程

### 8.1 不要直接复用旧 nodes.conf

nodes.conf 记录 node ID、地址和拓扑。若目标 IP、端口、主机名或节点数量变化，直接复制可能引入旧地址和错误握手。更安全的流程是：

1. 在隔离网络准备版本和模块一致的新节点；
2. 按原分片分别加载对应 RDB/AOF；
3. 创建新的 Cluster 拓扑；
4. 为每个 Master 分配原 Slot 范围；
5. 为其添加 Replica；
6. 验证所有 Slot 覆盖后再接流量。

同一份分片数据不能错误地加载到两个同时持有相同 Slot 的 Master。

### 8.2 验证拓扑

~~~bash
redis-cli --cluster check redis-recovery-0:6379
redis-cli -c -h redis-recovery-0 CLUSTER INFO
redis-cli -c -h redis-recovery-0 CLUSTER SLOTS
~~~

必须看到 cluster_state:ok、16384 个 Slot 完整覆盖、没有 fail/pfail 节点，也没有长期迁移中的 Slot。

### 8.3 验证数据

Key 总数不是充分条件。每个分片至少核对：

- db0 的 keys、expires、avg_ttl；
- 关键业务 Key 的类型、值、TTL 和编码；
- Stream 的 last-generated-id、消费者组和 pending；
- Sorted Set 的成员数和抽样排名；
- Module 数据能否加载；
- 热 Key 与大 Key 分布是否与恢复前相符。

~~~bash
redis-cli -c -h redis-recovery-0 INFO keyspace
redis-cli -c -h redis-recovery-0 TYPE business:key
redis-cli -c -h redis-recovery-0 TTL business:key
redis-cli -c -h redis-recovery-0 MEMORY USAGE business:key
~~~

## 9. TTL 是恢复中最容易漏掉的语义

Redis 保存的是绝对过期时间。若把一份旧 RDB 在几天后恢复，大量 Key 可能在加载时立即过期。这对缓存可能正确，对会话或补偿数据可能不符合业务预期。

恢复验收要同时记录：

~~~text
备份创建时间
恢复启动时间
数据冻结时长
关键 Key 的剩余 TTL
业务是否允许时间继续流逝
~~~

不能通过统一延长 TTL 来“修复”所有 Key，那会改变验证码、锁和幂等记录的安全语义。

## 10. 配置、权限与模块也是恢复依赖

RDB/AOF 不会自动带回完整运行环境。还要版本化保存：

- redis.conf 中持久化、内存淘汰、复制和 Cluster 配置；
- ACL 用户和权限；
- TLS 证书链和密钥引用；
- Redis Modules 及精确版本；
- systemd/Kubernetes 参数、ulimit、sysctl；
- 客户端发现地址与连接池策略。

加密密钥和证书私钥存 Secret/KMS，文档只保存引用和恢复流程。

## 11. 备份调度不能制造新的故障

BGSAVE/AOF Rewrite 都会 fork。写流量高时 Copy-on-Write 可能显著抬升 RSS，慢盘又会延长子进程生命周期。

监控：

- latest_fork_usec；
- rdb_last_cow_size、aof_last_cow_size；
- used_memory、used_memory_rss、mem_fragmentation_ratio；
- 持久化子进程耗时；
- 磁盘写延迟、剩余空间和复制延迟；
- Cluster 每个 Master 的备份完成时间差。

各分片可错峰执行以降低资源峰值，但错峰又会扩大全局恢复点窗口，需要在一致性和稳定性间明确取舍。

## 12. 恢复演练

### 12.1 单节点月度演练

~~~text
取回 RDB 与完整 AOF 目录
  → 校验 hash 和 manifest
  → 在隔离主机启动相同版本 Redis
  → 验证日志没有加载错误
  → 核对 Key/TTL/业务样本
  → 记录下载、加载和校验时间
~~~

### 12.2 Cluster 季度演练

完整重建新 Cluster、Slot、Replica 和客户端入口，注入一个分片损坏、一个备份对象缺失和一个模块版本错误，确认系统能在切流前识别失败。

演练报告至少给出：

| 指标 | 结果 |
| --- | --- |
| 恢复点时间 | 最晚包含到哪个业务时刻 |
| 数据损失窗口 | 实测 RPO |
| 下载/加载/拓扑/验收时间 | RTO 分解 |
| 关键 Key 正确率 | 业务校验 |
| TTL 偏差 | 时间语义 |
| 未恢复依赖 | 配置、模块或外部系统 |

## 13. 常见故障定位

### 13.1 启动时 Bad file format

先核对 Redis 版本、文件类型、Manifest、传输校验和和磁盘完整性。不要在原件上直接执行修复。

### 13.2 AOF 加载后比预期少数据

检查是否只复制了 Incr 或 Base、Manifest 是否匹配、备份时是否处于 Rewrite、appendfsync 策略和最后成功刷盘时间。

### 13.3 Cluster 恢复后 MOVED 循环

检查客户端缓存的 Slot Map、新集群公告地址、cluster-announce-ip/hostname、Slot 是否重复或缺失，以及负载均衡是否错误代理了 Cluster 总线。

### 13.4 恢复后大量 Key 消失

先看过期日志和备份年龄，确认是否因绝对 TTL 到期；再检查 maxmemory 与 eviction policy，避免恢复实例容量过小导致加载后立即淘汰。

## 14. 复盘题与答案

### 14.1 有 Replica 为什么还要外部备份

Replica 会同步 DEL、FLUSHALL、错误写入和逻辑损坏，也可能在主从切换时丢失未复制数据。外部备份提供独立历史恢复点。

### 14.2 为什么只复制 appendonly.aof.1.incr.aof 不能恢复

多段 AOF 的 Incr 只描述 Base 之后的变化，Manifest 决定文件序列；缺 Base 或 Manifest 就没有完整初始状态。

### 14.3 Cluster 所有节点都 BGSAVE 成功，为什么仍不能宣称零数据差异

各 Master 的快照发生在不同时间，Redis 没有跨分片全局快照事务。成功只证明每个分片局部产物有效。

### 14.4 为什么 Key 数一致仍不能证明恢复正确

值、类型、TTL、Stream 消费状态、Slot 归属和模块数据都可能错误，Key 数无法覆盖这些语义。

## 15. 延伸阅读

- [数据库可靠性与备份恢复学习路线](../../database-reliability/00-数据库可靠性与备份恢复学习路线.md)
- [Redis Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis Replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- [Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)

Redis 恢复的核心不是把进程拉起来，而是把每个分片的数据、TTL、拓扑和运行依赖恢复到一个有证据的业务边界。
