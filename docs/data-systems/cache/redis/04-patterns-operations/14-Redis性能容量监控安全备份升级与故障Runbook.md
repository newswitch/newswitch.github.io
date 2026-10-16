---
title: "性能、容量、监控、安全、备份、升级与故障 Runbook"
sidebar_label: "14. 性能、容量、监控、安全、备份、升级与故障 Runbook"
sidebar_position: 14
description: "建立 Redis 从 SLO、基准、容量、监控到备份升级和故障恢复的生产闭环。"
tags: [Redis, 性能, 容量规划, 安全, Runbook]
---

# 性能、容量、监控、安全、备份、升级与故障 Runbook

> 版本基线：Redis Open Source 8.x 的通用生产语义；命令、配置默认值、ACL Category 和持久化格式必须在目标小版本验证。本文命令默认连接隔离测试实例，生产执行前先评估开销。

Redis 的“快”来自内存访问和事件驱动，不代表任何命令、任何 Value 大小、任何持久化策略都低延迟。生产目标是：在副本同步、持久化、故障切换和流量突发同时发生时，仍满足业务正确性与 SLO。

## 1. 先定义业务语义和 SLO {/* #先定义业务语义和-slo */}

按工作负载拆开目标：

| 场景 | 必须定义 |
| --- | --- |
| Cache GET/MGET | 命中/未命中 P99、命中率、允许陈旧时间、回源保护 |
| SET/计数/锁 | P99、超时重试幂等、持久化和复制确认语义 |
| Lua/Functions | 执行 P99、操作元素上限、超时和失败原子性 |
| Pipeline/批量 | 单批命令数/字节、端到端 P99、客户端内存与输出缓冲 |
| Stream/Queue | 端到端延迟、积压、Pending、重复与丢失处理 |
| Sentinel/Cluster | RTO、允许的数据缺口、Slot/副本可用性 |

客户端超时必须大于健康条件下的目标 P99，但不能大到让请求无限堆积。重试要有次数、退避、幂等与总时限；Redis 或网络变慢时盲目重试会制造放大流量。

## 2. 延迟路径：CPU 低也可能很慢 {/* #延迟路径cpu-低也可能很慢 */}

```text
业务线程
→ 连接池排队/DNS/TCP/TLS/网络 RTT
→ Redis socket 读取
→ 主事件循环排队并执行命令
→ 内存/过期/淘汰/脚本
→ AOF fsync、Fork/COW、复制/Cluster 约束
→ 响应编码与客户端输出缓冲
→ 业务线程收到结果
```

Redis 主要命令执行仍由主线程串行推进。一个大集合运算、全 Key 遍历、慢 Lua 或大响应会阻塞其他客户端；I/O Thread 并不会把任意命令自动并行化。另一方面，客户端池等待、网络抖动、内核调度、Swap、AOF fsync 和 Fork 也会让 P99 上升，此时 Redis CPU 可能很低。

## 3. 建立基线和压力矩阵 {/* #建立基线和压力矩阵 */}

分别定义 GET/SET/脚本/批量请求的 P50/P95/P99、错误率和可用性。压测使用真实 key/value、Pipeline、连接数、TLS 和读写比例，并同时运行持久化、复制和故障恢复。

测试矩阵至少包含：

- Key/Value P50、P95、P99，String/Hash/Set/ZSet/Stream 的真实元素数；
- 热点分布、TTL 分布、命中率、读写比例、Lua/Function 与事务；
- 无 Pipeline、真实 Pipeline 和异常大批量；
- RDB/AOF、AOF rewrite、Replica 全量同步、主从切换；
- 单机、Sentinel、Cluster，并验证一个节点/一个 AZ 故障；
- 正常流量、突发、过载与恢复阶段。

`redis-benchmark` 可做协议和命令基线，但不能替代真实客户端池、序列化、数据结构和业务流量回放。每个档位持续跨越 BGSAVE/AOF rewrite 和 TTL 周期，同时采集 Client、Redis、OS 与副本证据。

安全容量是“第一个违反 SLO 的档位以下，再保留故障、Fork 和增长余量”，不是实验最大 QPS。

## 4. 容量：内存不等于 `maxmemory` {/* #容量内存不等于-maxmemory */}

容量至少包含：

```text
数据集：Key + Value + 数据结构对象与编码
+ 过期字典、Cluster、模块与索引
+ allocator 碎片和 RSS 偏差
+ Client output/query buffer
+ replication backlog、副本缓冲、AOF buffer
+ Fork 期间 Copy-on-Write 峰值
+ OS、页缓存与故障余量
```

用目标版本和真实数据装载后测“每个业务对象的内存放大”，不要用序列化文件大小估算。重点区分：

| 指标 | 含义 |
| --- | --- |
| `used_memory` | Redis 分配器统计的内存 |
| `used_memory_dataset` | 数据集部分，不含全部开销 |
| `used_memory_rss` | OS 看到的 Redis RSS |
| `mem_fragmentation_ratio` | RSS 与分配内存关系的粗略信号，不能单独下结论 |
| `allocator_active/resident` | 分配器活跃/驻留页，用来分解碎片 |
| `mem_not_counted_for_evict` | 不计入淘汰判断但仍占内存的缓冲 |
| `current_cow_peak` 等 Fork 指标 | RDB/AOF rewrite 期间 COW 额外内存 |

`maxmemory` 控制 Redis 内部淘汰/拒写边界，不限制进程 RSS，也不覆盖全部复制/AOF/客户端缓冲。容器 Limit 或主机内存必须高于 `maxmemory`，并按高峰写入率实测 COW。否则 Redis 还没来得及执行淘汰，就可能先被 cgroup OOM Kill。

磁盘需同时容纳当前 RDB/AOF、Rewrite 临时文件、备份复制、日志和安全余量；网络需容纳业务峰值加副本全量同步与 Cluster 迁移。

## 5. 监控与现场命令 {/* #监控与现场命令 */}

- 客户端：池等待、超时、重试、命中率、请求分位数；
- Redis：命令、latency、slowlog、CPU、memory、eviction、clients；
- 数据：key 数、TTL、热/大 Key、复制 offset、持久化；
- 系统：cgroup、RSS、磁盘 fsync、网络重传、时钟和故障域。

### 5.1 低开销基线 {/* #低开销基线 */}

```bash
redis-cli INFO server
redis-cli INFO clients
redis-cli INFO memory
redis-cli INFO stats
redis-cli INFO persistence
redis-cli INFO replication
redis-cli INFO commandstats
redis-cli INFO errorstats
```

保存实例角色、版本、uptime、连接、blocked_clients、instantaneous ops、keyspace hits/misses、expired/evicted keys、fork、持久化、复制 offset 和错误。比较故障前基线与当前值，不要只截一张瞬时 `INFO`。

### 5.2 延迟与慢命令 {/* #延迟与慢命令 */}

```bash
redis-cli --latency
redis-cli LATENCY LATEST
redis-cli LATENCY DOCTOR
redis-cli SLOWLOG LEN
redis-cli SLOWLOG GET 128
```

先在配置中设置合适的 `latency-monitor-threshold`；阈值为 0 时 Latency Monitor 不采样。Slowlog 记录服务端命令执行时间，不包含网络和客户端池等待，因此“应用慢但 Slowlog 空”应继续查连接池、RTT、事件循环 Fork/fsync 和 OS。

服务器本机可用 `redis-cli --intrinsic-latency 100` 测量内核/虚拟化调度基线；它会占用一个 CPU，应在隔离或维护评估后运行。

### 5.3 内存和 Key 分布 {/* #内存和-key-分布 */}

```bash
redis-cli MEMORY STATS
redis-cli MEMORY DOCTOR
redis-cli --bigkeys
redis-cli --memkeys
```

这些扫描会遍历 Keyspace，即使使用 SCAN 也会消耗 CPU 和网络；控制扫描速率并优先在副本/隔离恢复数据上分析。`--hotkeys` 依赖 LFU 计数语义，不能在未满足条件时把结果当热点真相。禁止在大生产实例直接执行 `KEYS *`；`MONITOR` 也可能产生巨大流量与敏感数据泄露，只能短时、受控、脱敏使用。

### 5.4 OS 层 {/* #os-层 */}

对齐 `vmstat 1`、`pidstat`、`iostat -x 1`、网络重传、cgroup throttling/OOM、NUMA、THP 和时钟。检查 Redis RSS 是否发生 Swap；一旦内存页换入磁盘，单次访问就会变成长尾。Fork 延迟可从 `latest_fork_usec` 与实例内存规模判断。

## 6. 告警不是越多越好 {/* #告警不是越多越好 */}

至少覆盖：业务 P99/错误/池等待、connected/blocked/rejected clients、evicted keys、命中率突变、内存/RSS/cgroup、主线程 CPU、Slowlog/Latency 事件、RDB/AOF 最近结果与时长、磁盘空间、主从 offset/lag/link、full sync、Sentinel 主观/客观下线、Cluster slot 与 node link。

阈值由 SLO 和基线决定。例如副本 lag 应同时看字节和时间；固定“差 1 MB 就告警”在不同写速率下意义不同。

## 7. 安全 {/* #安全 */}

Redis 只能暴露在可信私网，通过防火墙/安全组限制 Client、Sentinel、Cluster bus 和管理来源。启用 TLS 与 ACL：每个应用独立用户，按 Key pattern、Command Category 和 Pub/Sub channel 最小授权；备份、监控、复制和管理员身份分离。

`default` 用户应按计划禁用或收紧，密码/证书放 Secret Manager。ACL 变更先做一个保留的管理员会话，再用应用身份验证允许和拒绝路径。`ACL SETUSER` 的规则是按顺序累计/覆盖的，变更前后用 `ACL GETUSER` 检查最终规则；不要把 Secret 直接写进 Shell 历史。

重命名或禁用 `FLUSHALL`、`CONFIG` 等危险命令只能减少误操作，不能替代网络隔离、ACL 和审计。升级也可能增加新命令，Category 授权需要重新评审。

审计登录失败、ACL 修改、配置、拓扑、Failover、Slot 迁移、备份恢复和升级；日志避免记录 Value、Token、Session、完整 Key 和用户密码。

## 8. 持久化、复制与备份解决不同问题 {/* #持久化复制与备份解决不同问题 */}

| 能力 | 解决什么 | 不能解决什么 |
| --- | --- | --- |
| Replica | 节点故障与读副本 | 误删/错误写会复制过去，不是历史备份 |
| RDB | 某时间点紧凑快照、快速恢复 | 两次快照之间可能丢数据 |
| AOF | 按策略记录写操作，降低 RPO | 误操作也被记录，文件可能需校验/修复 |
| 异地不可变备份 | 人为错误、集群级灾难、勒索 | 必须演练才能证明可恢复 |

备份集合包含匹配时点的 RDB/AOF、`redis.conf`、ACL 文件、模块及其版本、拓扑/Slot、TLS 与 Secret 的受控引用、校验和和生成日志。复制到异机或对象存储后做不可变保留。

### 8.1 恢复演练 {/* #恢复演练 */}

1. 在隔离环境使用相同版本/模块和只读备份副本启动。
2. 检查加载日志、RDB/AOF 完整性、Key 数、TTL 分布和抽样 Value。
3. 运行应用级不变量：会话有效性、计数范围、Stream Pending、锁不能误复活。
4. 验证 ACL/TLS、内存放大、加载时间和真实 RTO。
5. Cluster 还要重建并核对全部 16384 Slot 与副本覆盖。

缓存数据可能允许直接清空重建，锁、队列、幂等记录却可能不能恢复旧状态。每类 Key 必须定义恢复策略，不能对整个 Redis 只写一个 RPO/RTO。

## 9. 升级与回滚 {/* #升级与回滚 */}

先阅读目标版本所有中间 Release Notes，检查配置项、持久化格式、模块 ABI/API、客户端、ACL Category、Sentinel/Cluster 协议和命令行为。用生产备份克隆数据测试启动、加载、复制、Failover 与回退。

有副本的拓扑通常先升级一个副本，等待全量/增量同步并验证，再受控切换，将旧主保留为回退边界，最后逐个完成；Cluster 必须始终保证每个 Slot 有可提升的健康副本。具体顺序仍以目标版本官方升级说明为准。

回滚前确认新版本是否写入旧版本不能读取的 RDB/AOF 或模块数据。升级后新写入一旦发生，直接切回旧主可能丢数据或形成双主；必须 Fence 旧主、明确权威 offset/数据集，再决定反向复制、恢复备份还是保持向前修复。

## 10. Runbook {/* #runbook */}

### 10.1 P99 突升 {/* #p99-突升 */}

```text
应用 P99
→ pool wait/timeout/retry 与网络 RTT
→ Redis --latency、Latency Monitor、Slowlog/commandstats
→ 大 Key/慢脚本/事件循环 CPU
→ Fork/COW、AOF fsync、过期/淘汰
→ Swap、THP、cgroup throttle、网络重传
```

先限流异常命令/大批量和重试风暴，保留 Slowlog、Latency、INFO 与 OS 时间线。不能因为 CPU 低就直接扩容；如果是池耗尽或 fsync，扩 Redis 节点不一定有效。

### 10.2 OOM 或内存逼近上限 {/* #oom-或内存逼近上限 */}

比较 `used_memory`、RSS、cgroup、allocator、client/replication buffer、COW 和 Swap。若数据集增长，查新 Key、TTL、淘汰策略和业务写入；若 RSS/COW 激增，停止非必要 BGSAVE/rewrite（先理解持久化后果）、降低写峰值并保护主机余量。

不要在未知 Key 归属时执行批量 DEL/FLUSH，也不要只提高容器 Limit 后结束事故。恢复标准包括增长根因停止、淘汰/拒写符合预期、Fork 峰值仍有余量。

### 10.3 Replica 断开或反复 Full Sync {/* #replica-断开或反复-full-sync */}

检查 `master_link_status`、offset/lag、repl backlog、断线时长、网络/TLS/ACL、磁盘与加载时间。Backlog 覆盖不了断线期间写入就会全量同步；全量同步又消耗 Fork、内存、磁盘和网络，可能形成循环。

先稳定链路和资源，限制并行全量同步，再重建一个副本。主从角色变化前确认权威 offset 和写入入口，防止旧主继续接受写。

### 10.4 AOF/RDB 失败 {/* #aofrdb-失败 */}

立即确认当前持久化策略与写入安全开关，保护现有 AOF/RDB，不先删除或截断。查磁盘满、inode、权限、fsync、文件系统和 Rewrite。若配置允许在 AOF 错误后继续写，要明确新增数据的风险；恢复文件只在副本上使用官方检查工具并保留原件。

### 10.5 Sentinel/Cluster 故障 {/* #sentinelcluster-故障 */}

Sentinel 场景检查 Sentinel 多数派、主观/客观下线、网络分区和旧主 Fence；Cluster 检查 Slot 覆盖、node link、Fail/PFail、Replica eligibility 和迁移状态。不要在网络分区未确认时手工提升多个节点或执行激进 `cluster fix`。

任何拓扑恢复都要验证：唯一写主、复制 offset 前进、所有 Slot Covered、客户端刷新拓扑、真实读写成功、旧主已隔离并按副本重建。

任何修复先保留日志、INFO、拓扑和持久化文件，不在未知路径上删除数据。

## 11. 验收题 {/* #验收题 */}

- 平均延迟和单机 QPS 为什么不能代表容量？
- 副本、RDB/AOF 与离线备份分别解决什么？
- Redis CPU 低但 P99 高时按什么顺序排查？
- 升级回滚为什么需要数据格式验证？
- `maxmemory` 为什么不能直接等于容器 Memory Limit？
- Replica 反复 Full Sync 为什么可能进一步拖慢主库？

## 12. 参考资料 {/* #参考资料 */}

- [Redis administration](https://redis.io/docs/latest/operate/oss_and_stack/management/)
- [Redis latency monitoring](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency-monitor/)
- [Diagnosing latency issues](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/)
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis ACL](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)
