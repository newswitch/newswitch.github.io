---
title: "Topic/Queue、吞吐、存储、网络与容量规划"
sidebar_label: "12. Topic/Queue、吞吐、存储、网络与容量规划"
sidebar_position: 12
description: "按消息速率、大小、保留、副本、积压和恢复估算 RocketMQ Broker。"
tags: [RocketMQ, 容量规划, Queue, Storage]
---

# Topic/Queue、吞吐、存储、网络与容量规划

RocketMQ 容量不是“消息数除以机器 QPS”。必须同时满足峰值写入、消费读出、副本同步、保留空间、积压追平、节点故障、定时洪峰和业务 SLO。最终瓶颈可能在 Broker 磁盘，也可能在 Producer、Proxy、Consumer 或下游数据库。

## 1. 先定义 SLO 与工作负载

没有目标就没有容量。至少记录：

| 输入 | 示例 |
| --- | --- |
| 平均/峰值消息速率 | 50k / 150k msg/s |
| P50/P95/P99 编码后大小 | 0.8 / 2 / 16 KiB |
| Topic/Queue 与 Key 分布 | 30 Topic，是否有单热 Key |
| 消息类型占比 | Normal/FIFO/Delay/Transaction |
| 保留与最长积压 | 72 h / 6 h |
| Consumer Group 数 | 5 个独立 Group |
| 发送确认 | sync/async、flush、replica ACK |
| SLO | send P99、deliver P99、可用率、RPO/RTO |
| 故障模型 | 丢 1 Broker、1 AZ、1 Proxy 池 |

消息大小必须用编码后实际值。只用 body 平均数会漏掉属性、Key、协议头、批量开销和长尾大消息。

## 2. 写入与读取流量模型

```text
logical_ingress_Bps
  = produce_msg_s × encoded_bytes

consumer_egress_Bps
  ≈ logical_ingress_Bps × active_consumer_groups

replication_Bps
  ≈ logical_ingress_Bps × replica_followers

total_network_Bps
  ≈ producer_ingress
   + consumer_egress
   + replication
   + protocol/retry/recovery overhead
```

若 100 MiB/s 写入、3 个独立 Consumer Group、2 个 follower，忽略开销也已经接近：

```text
100 MiB/s ingress
+ 300 MiB/s consumer egress
+ 200 MiB/s replication
= 600 MiB/s aggregate traffic
```

这不是单网卡精确值，因为流量分散于节点和方向，但说明“只按生产写流量选网卡”会严重低估。

## 3. 磁盘容量模型

```text
commitlog_bytes
  = ingress_Bps × retention_seconds

physical_cluster_bytes
  = commitlog_bytes × replica_copies
  + ConsumeQueue / Index / checkpoint
  + retry / DLQ / transaction / timer overhead
  + logs and temporary recovery space
  + safety headroom
```

例如编码后稳定写入 40 MiB/s、保留 72 小时、3 副本，仅 CommitLog 理论量：

```text
40 × 72 × 3600 ≈ 10.1 TiB logical
10.1 × 3 ≈ 30.4 TiB physical
```

生产不能把磁盘用到 100%。还要为滚动清理的 segment 粒度、流量增长、积压延长、重建索引和副本追平预留空间。扩容触发点应基于“按当前增长速率多久达到保护水位”，而不是等到 90% 才行动。

## 4. 磁盘性能不只看吞吐

Broker 写入主要是顺序追加，但同步刷盘、读取积压、日志、索引和副本恢复会形成混合 I/O。验证：

- 顺序写吞吐是否覆盖峰值和副本恢复；
- `fsync` P95/P99 是否满足同步发送 SLO；
- 同时读取多个 Consumer Group 时设备 await；
- 云盘 IOPS/吞吐突发额度能持续多久；
- 磁盘接近满时清理与写入竞争；
- 单盘故障后的重建窗口。

不要用裸盘 `dd` 峰值代替 RocketMQ 端到端压测。

## 5. Queue 数怎样估算

Queue 既是消费并行单元，也是路由/文件/重平衡成本。初步可以从两个下界出发：

```text
queues_for_throughput
  >= peak_topic_rate / tested_single_queue_stable_rate

queues_for_consumers
  >= required_parallel_consumer_instances
```

然后校验：

- Queue 能否在 Broker 间均匀分布；
- FIFO MessageGroup 是否倾斜；
- 节点故障后剩余 Broker 能否承接 Queue；
- Consumer 实例数是否长期频繁超过 Queue；
- 路由元数据、文件和 Rebalance 成本是否可接受。

单热 Queue/Group 无法靠增加其他 Queue 的平均容量解决。需要重设计业务 Key 或把热点业务独立 Topic。

## 6. CPU、内存与线程池

Broker CPU 消耗来自协议编解码、校验/ACL、压缩、Filter、索引、请求 Processor 和 GC；Proxy 还承担 gRPC 连接与路由；Consumer CPU 则受反序列化和业务逻辑影响。

内存分三类考虑：

```text
JVM Heap
+ Direct/Netty buffers
+ OS Page Cache for CommitLog reads/writes
```

给容器设置 limit 时不能只容纳 Heap。Heap 过大也会挤压 Page Cache，导致读写抖动。用压力测试观察 RSS、Page Cache、Direct Memory、GC pause、缺页和 OOM，而不是套固定比例。

线程池排队可以在 CPU 不高时制造高延迟，例如请求等待磁盘/副本/下游。监控活动线程、队列长度、拒绝和处理分位数。

## 7. Producer 与 Proxy 容量

Producer 容量受序列化、in-flight、连接、batch 和 retry 限制。Proxy 集群受连接数、每连接流量、gRPC 流、CPU、内存和到 Broker 的网络限制。

Proxy 定容至少测试：

- 稳态与连接重建风暴；
- 一个 Proxy 下线后的 N-1 容量；
- 长连接分布是否均衡；
- TLS 握手/加密 CPU；
- 大消息与慢客户端；
- 滚动发布时 drain 时间；
- Proxy→Broker 单热点。

## 8. Consumer 和下游才可能是最终瓶颈

消费容量：

```text
consumer_rate
  ≈ active_workers / business_handler_avg_seconds
```

但只有 Queue、数据库连接池、锁、第三方 API 和幂等表都允许时成立。扩大 Consumer 线程却不扩大下游，只会增加超时、重试和数据库争用。

积压追平：

```text
net_drain = stable_consume_rate - ongoing_produce_rate
catch_up  = backlog / net_drain
```

设计目标不是“恢复后刚好跟上”，而是能在业务规定时间内追平，同时不违反下游 SLO。

## 9. 特殊消息的额外容量

| 类型 | 额外考虑 |
| --- | --- |
| FIFO | 热 MessageGroup、串行处理、毒消息阻塞 |
| Delay | 平均等待时长、同时到期洪峰、时钟/调度 |
| Transaction | Half 数量、回查 QPS、UNKNOWN 年龄 |
| Retry/DLQ | 失败放大、额外 Topic/存储与重放洪峰 |
| LiteTopic | 父 Topic 总吞吐、通道数量/TTL、长轮询和动态订阅 |
| Batch | in-flight 字节、凑批延迟、失败粒度 |

容量压测必须包含真实类型比例，全部使用 Normal 消息得出的结果不能直接用于生产。

## 10. 节点故障后的容量

正常利用率不能以 90% 为目标。若 3 个同等 Broker 需要承受任意 1 个故障：

```text
normal per-node load ≈ total / 3
failure per-node load ≈ total / 2
```

还未计算副本重建。因此正常稳态至少要为 N-1 流量、恢复 I/O 和增长留余量。Controller/NameServer 也应跨故障域，Proxy/LB 要有 N-1 连接能力。

## 11. 分阶段压测

### 11.1 基准阶段 {/* #基准阶段 */}

固定版本、拓扑、Topic、Queue、消息分布、刷盘/复制和 SDK 参数，找单节点与单 Queue 的稳定点。

### 11.2 业务阶段 {/* #业务阶段 */}

加入真实大小分布、Key 倾斜、多个 Group、Filter、事务/延迟、下游耗时和 retry。

### 11.3 故障阶段 {/* #故障阶段 */}

在持续负载下分别停止 Proxy、Broker replica/Master、Controller follower，并注入慢盘/慢网，测 RPO/RTO 与 P99。

### 11.4 积压阶段 {/* #积压阶段 */}

暂停 Consumer 制造目标最大积压，恢复后测净追平速率、磁盘读取对在线写入的影响和下游保护。

### 11.5 长稳阶段 {/* #长稳阶段 */}

至少覆盖保留/清理周期、JVM GC、磁盘水位、连接轮换和定时消息到期峰值。

## 12. 测试结果怎样转成生产容量

不要使用压测中出现过一次的最高 TPS。选择所有 SLO 同时满足的稳定吞吐 `T_stable`，再施加安全系数：

```text
usable_capacity_per_node
  = T_stable × safety_factor

required_nodes
  >= peak_load / usable_capacity_per_node
     + failure/headroom requirement
```

安全系数来自业务增长、硬件抖动、版本升级和故障模型，不是统一的 70%。还要分别对网络、磁盘空间、fsync P99、CPU、内存、Queue 和下游做约束，最终取最严格的节点数。

## 13. 容量告警

| 信号 | 行动 |
| --- | --- |
| 未来若干天达到磁盘保护水位 | 提前扩容/降保留，不等满盘 |
| send P99 接近 SLO 且 flush/ACK 上升 | 检查存储和复制余量 |
| Queue P99 lag 明显高于均值 | 查热 Key/owner/毒消息 |
| `net_drain <= 0` | 当前容量永远追不平，立即限流/扩容 |
| N-1 后利用率超过稳定点 | 不满足故障容量，禁止继续增长 |
| Retry/Half/Delay 占比异常 | 修正容量模型并查业务故障 |

## 14. 容量规划交付物

最终文档应包含：

- 版本和硬件/云盘规格；
- Topic/Queue/消息类型/Group 清单；
- 峰值与大小分位数；
- 存储、网络、CPU、内存公式和实测值；
- 正常、N-1、积压追平和恢复场景；
- SLO/RPO/RTO 与测试证据；
- 扩容提前量、Owner 和成本；
- 哪些假设需要每月重新测量。

## 15. 验收题

- 为什么容量要同时计算 consumer egress？
- Queue 多有什么元数据/文件成本？
- 平均消息大小为何不足以定容？
- 追平积压需要怎样的净消费余量？
- 为什么同步刷盘容量必须看 fsync P99 而不只是顺序吞吐？
- N-1 容量为什么还要加入副本重建带宽？
- Heap、Direct Memory 和 Page Cache 怎样相互竞争？
- 哪些特殊消息会放大存储和调度成本？

## 16. 参考资料

- [RocketMQ 基础最佳实践](https://rocketmq.apache.org/docs/bestPractice/01bestpractice/)
- [消息存储与清理](https://rocketmq.apache.org/docs/featureBehavior/11messagestorepolicy/)
- [RocketMQ 指标](https://rocketmq.apache.org/docs/observability/01metrics/)
