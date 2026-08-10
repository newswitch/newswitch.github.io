---
title: Kafka Topic、Partition、磁盘、网络与容量规划
sidebar_position: 6
tags: [Kafka, 容量规划, Partition, 性能]
description: 从峰值流量、保留、副本、恢复和消费者并行度估算 Kafka broker、partition、磁盘与网络。
---

# Kafka Topic、Partition、磁盘、网络与容量规划

Kafka 规划不能只用“每天多少 GB”。需要同时考虑峰值 records/bytes、记录大小分布、压缩、保留、副本、consumer fan-out、故障恢复和 partition 控制面成本。

## 1. 输入清单

| 量 | 作用 |
|---|---|
| 平均/峰值 records/s 与 bytes/s | 请求、网络和吞吐 |
| P50/P99/max record size | batch、broker 限制与内存 |
| topic retention/compaction | 磁盘容量 |
| replication factor/min ISR | 写放大与可靠性 |
| consumer group 数 | 出站网络放大 |
| 最大停机/重放窗口 | 保留期与恢复目标 |
| key 分布 | 热 partition 风险 |

## 2. 容量公式

```text
逻辑保留字节 ≈ ingress_bytes/s × retention_seconds / compression_ratio
集群日志字节 ≈ 逻辑保留字节 × replication_factor
规划磁盘 = (日志 + 索引 + 重分配/恢复余量) / 目标最高使用率
```

Compacted topic 的最终大小取决于 key 基数、更新频率、tombstone 和 cleaner 追赶能力，不能只用 retention 公式。

## 3. 网络模型

粗略估算：

```text
broker入站 ≈ producer入口 + follower复制拉取
broker出站 ≈ follower复制 + 各consumer group读取 + 重分配/恢复
```

三个独立 group 全量消费会把读出流量放大约三份。故障后 follower catch-up 和 partition reassignment 还会与正常流量争抢。

## 4. Partition 数

先分别估算 producer 和单 consumer instance 实测吞吐：

```text
partition下限 ≈ max(峰值入口/单partition写能力,
                    峰值出口/单consumer实例能力,
                    目标消费并行度)
```

再检查每 broker partition/leader 数、控制面规模、文件句柄、内存和恢复时间。单 partition 能力必须在相同记录、acks、压缩、磁盘和副本条件下实测。

Partition 不宜过少导致热点和并行不足，也不宜“预留无限多”。增加 partition 对 key 映射和顺序有影响；减少通常需要迁移到新 topic。

## 5. Broker 与磁盘

均衡 CPU、内存、网络和多块磁盘。Kafka 强依赖 page cache，给 JVM heap 分配全部内存会挤压缓存。日志盘应监控容量、吞吐、await、坏盘和各目录分布；RAID、JBOD 与副本策略要结合故障域和运维能力选择。

节点数还由容错约束决定：失去一个 broker 后，剩余节点能承载 leader、吞吐和副本恢复，并满足 min ISR。

## 6. 水位与扩容

容量告警应基于增长速度和预计耗尽时间，而非只在 90% 报警。扩容包含加 broker、迁移 partition、观察业务和 leader 均衡；迁移限速过高会影响 P99，过低又延长风险窗口。

## 7. 基准矩阵

固定数据集，测试不同 record/batch/compression/acks、partition 数、producer/consumer 数。记录吞吐、P99、CPU、磁盘、网络、request queue 和 ISR。再停止一台 broker，验证降级能力与恢复时间。

## 8. 掌握验收

- 计算保留、副本、压缩和安全水位后的磁盘；
- 计算多个 consumer group 的出站放大；
- 用实测单 partition 能力推导数量；
- 说明 page cache 与 JVM heap 的关系；
- 将故障恢复和 reassignment 带宽纳入规划。

上一篇：[Kafka 事务与 Exactly-Once](./05-Kafka事务与端到端Exactly-Once.md)　下一篇：[积压、故障排查、滚动升级与 Kubernetes](./07-Kafka积压故障排查滚动升级与Kubernetes.md)

## 参考资料

- [Kafka Operations](https://kafka.apache.org/documentation/#operations)
