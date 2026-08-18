---
title: "线性/串行读、延迟、吞吐、磁盘 fsync 与容量规划"
sidebar_label: "09. 线性/串行读、延迟、吞吐、磁盘 fsync 与容量规划"
sidebar_position: 9
description: "按请求语义、值大小、Watcher、WAL fsync 和故障恢复规划 etcd。"
tags: [etcd, Performance, fsync, 容量规划]
---

# 线性/串行读、延迟、吞吐、磁盘 fsync 与容量规划

> 本文以 etcd 3.6 为基线。容量规划的结果不是“推荐几核几 G”，而是一份能用真实负载、故障和 SLO 复现的证据。

## 1. 先把一次请求拆开 {/* #先把一次请求拆开 */}

```text
客户端 → Endpoint/gRPC → Leader 排队与批处理
       → Raft WAL 持久化 → peer 复制 → 多数派确认
       → commit → MVCC/bbolt apply → 返回客户端
```

写延迟至少受客户端网络、Leader 排队、WAL `fdatasync`、多数派 peer RTT/落盘和 Backend apply 影响。Raft 不等待所有成员，因此“最慢节点一定决定每次写”并不准确；决定提交的是组成多数派的确认集合。但一个持续慢或离线成员会吃掉冗余，使剩余成员中的慢盘/慢网直接进入多数派路径，并放大尾延迟与选举风险。

## 2. 一致性不是性能开关 {/* #一致性不是性能开关 */}

| 请求 | 主要路径 | 能保证什么 | 典型代价 |
| --- | --- | --- | --- |
| Serializable Range | 任一成员本地状态 | 可能返回陈旧值 | 不需要为最新状态向 quorum 确认，延迟低 |
| Linearizable Range | ReadIndex/Leader 与 quorum 确认后读取 | 返回调用时点可线性化的最新结果 | 受 Leader、peer RTT 和 quorum 健康影响 |
| Put/Txn/Lease 变更 | Leader + Raft 多数派 + apply | 变更按共识顺序提交 | 受 WAL fsync、网络和 Backend 影响 |
| Watch | 初始 Revision 后持续推送事件 | 按 Revision 观察变化 | 占连接、内存、序列化和客户端消费能力 |

不能为了跑分快就把需要“读到刚写入结果”的业务改成 Serializable。先写出业务允许的陈旧度与正确性，再选择一致性级别。

慢 Watcher 的问题也不只是连接数：大量 Watch、过宽 Prefix、事件突发或客户端消费慢会增加内存和发送压力。客户端还必须处理断线、Compacted Revision、重新 List/Watch 和背压。

## 3. 指标如何映射到瓶颈层 {/* #指标如何映射到瓶颈层 */}

| 证据 | 更可能的层 | 进一步验证 |
| --- | --- | --- |
| `etcd_disk_wal_fsync_duration_seconds` P99 同步升高 | WAL 盘或宿主 I/O 抢占 | `iostat`/`fio`、云盘突发余额、同盘进程 |
| `etcd_disk_backend_commit_duration_seconds` 升高 | bbolt commit、磁盘或大事务 | 对照写入大小、Compaction、Snapshot、磁盘延迟 |
| peer RTT/网络重传升高，fsync 正常 | 成员网络或跨故障域路径 | RTT、丢包、MTU、队列和拓扑 |
| `etcd_server_proposals_pending` 堆积 | Leader 处理或下游提交变慢 | 同看 CPU、fsync、peer RTT 和大请求 |
| Leader changes 增加 | 心跳超时、慢盘、网络抖动或停顿 | 对齐日志、fsync、RTT、CPU throttle/GC |
| Serializable 快、Linearizable 慢 | quorum/Leader 路径 | 查 Leader 负载、peer 网络和成员健康 |

低且稳定的持久化延迟比顺序吞吐峰值更重要。etcd 与容器镜像、应用日志、备份任务共享磁盘时，平均值可能仍好看，但 P99 fsync 会周期性恶化。官方把快速磁盘视为稳定性的关键因素；应在目标硬件上用同步写模型测试，而不是拿厂商标称 IOPS 代替。

## 4. 容量模型：分五张账 {/* #容量模型分五张账 */}

### 4.1 当前数据量 {/* #1-当前数据量 */}

```text
Live Data ≈ Key 数 ×（平均 Key + 平均 Value + MVCC/索引开销）
```

开销与 Key 分布、Lease、版本数有关，不能用一个固定倍数替代实测。用接近生产的快照或数据生成器测出真实 DB size。

### 4.2 历史增长 {/* #2-历史增长 */}

```text
History Growth ≈ 每秒写 Revision × 每次变更平均占用 × Compaction 保留秒数
```

热点 Key 反复更新同样会产生历史。保留窗口越长，离线 Watch 可续接时间越长，但 Backend、快照和恢复成本越大。

### 4.3 物理空间 {/* #3-物理空间 */}

```text
所需磁盘 > Backend quota + WAL/快照 + Defrag 临时空间 + 日志 + 故障突发余量
```

Backend quota 是故障保护上限，不是计划使用率。还要给 Defrag、临时快照、文件系统和异常写入留空间。quota 提高后，快照传输与 Restore 时间也会增长。

### 4.4 请求与 Watch 容量 {/* #4-请求与-watch-容量 */}

分别统计线性读、串行读、Put、Txn、Lease、Watch 数、事件速率、Key/Value P50/P99、单事务操作数和客户端连接。只用总 QPS 会掩盖“少量大事务”或“大量空闲 Watch”。

### 4.5 RPO/RTO {/* #5-rporto */}

```text
粗略 Restore 数据阶段时间 ≈ 快照大小 ÷ 实测恢复吞吐
总 RTO = 获取备份 + Restore + 启动选举 + 完整验证 + 上层重新同步
```

真实 RTO 往往卡在证书、网络变更、Kubernetes Informer 重建和人工审批，而不是单纯磁盘复制。必须靠演练测量。

大配置包、模型文件、日志和用户数据不应存进 etcd；把对象放对象存储或数据库，etcd 只保存小型协调元数据和引用。

## 5. Benchmark：先定义矩阵，再运行工具 {/* #benchmark先定义矩阵再运行工具 */}

在隔离、同规格、启用真实 TLS 的环境运行官方 `benchmark`。先做单连接基线，再逐级增加并发，不能一上来只测最大 QPS。

```bash
# 单连接写入基线
benchmark --endpoints="$ETCD_ENDPOINT" --target-leader \
  --conns=1 --clients=1 \
  put --key-size=8 --sequential-keys --total=10000 --val-size=256

# 高并发写入示例
benchmark --endpoints="$ETCD_ENDPOINT" --target-leader \
  --conns=100 --clients=1000 \
  put --key-size=8 --sequential-keys --total=100000 --val-size=256

# 对同一已存在 Key 比较线性读与串行读
benchmark --endpoints="$ETCD_ENDPOINTS" --conns=100 --clients=1000 \
  range YOUR_KEY --consistency=l --total=100000
benchmark --endpoints="$ETCD_ENDPOINTS" --conns=100 --clients=1000 \
  range YOUR_KEY --consistency=s --total=100000
```

测试矩阵至少包含：

- 真实 P50/P99 Value 大小、热点与离散 Key；
- 真实读写比例、Txn 操作数、Lease 与 Watch；
- 1、正常、峰值和过载并发；
- 无故障、失去一个 follower、Leader 迁移、单成员慢盘/慢网；
- 正常期以及 Snapshot、Compaction、逐成员 Defrag 维护窗口。

每轮同时采集 QPS、P50/P95/P99/P999、超时/错误、CPU、内存、网络、WAL fsync、Backend commit、proposal pending、Leader changes 和 DB 增长。每个档位持续到缓存、磁盘和 Compaction 周期都出现；短跑数据不能代表稳态。

:::warning
`benchmark put` 会真实写入数据。不要在生产集群运行破坏性压力；测试 Prefix、清理方式和 quota 必须在隔离环境预先设计。
:::

## 6. 从 SLO 反推安全容量 {/* #从-slo-反推安全容量 */}

假设业务要求线性读 P99 小于 50 ms、写 P99 小于 100 ms、错误率低于 0.1%，并且失去一个 follower 后仍满足目标。逐步加压，找到第一个违反任一 SLO 的档位，再把该点以下留出故障、维护和增长余量，才是安全容量。不能直接把实验最大 QPS 当生产配额。

出现容量不足时按层处理：先缩小异常 Value/Txn/Watch，修复慢盘和网络，再考虑拆分业务或增加资源。增加 etcd 投票成员通常会增加写入共识成本；它不是通用的写扩容手段。

## 7. 验收题 {/* #验收题 */}

- 写延迟为何受多数派中较慢成员影响？
- 串行读快在哪里、牺牲什么？
- Watcher 慢如何影响服务？
- 为什么 etcd 不能存大配置包？
- 为什么“失去一个 follower 后仍满足 SLO”比健康集群最大 QPS 更重要？
- fsync P99 正常但线性读明显变慢时，下一步看哪一层？

## 8. 参考资料 {/* #参考资料 */}

- [etcd performance](https://etcd.io/docs/v3.6/op-guide/performance/)
- [Hardware recommendations](https://etcd.io/docs/v3.6/op-guide/hardware/)
- [Maintenance](https://etcd.io/docs/v3.6/op-guide/maintenance/)
