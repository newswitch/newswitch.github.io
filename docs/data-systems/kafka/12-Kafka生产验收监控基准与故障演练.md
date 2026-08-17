---
title: "生产验收、监控告警、基准测试与故障演练"
sidebar_position: 12
tags: [Kafka, Monitoring, Benchmark, Runbook]
description: "建立 Kafka 从端到端 SLO、容量和监控到 Broker/Controller/磁盘故障演练的验收体系。"
---

# 生产验收、监控告警、基准测试与故障演练

## SLO

分别定义 Produce 成功/端到端延迟、Consumer lag 时间、可用性、数据缺口和重复容忍。Broker request latency 不等于消息业务完成时间。

## 监控

```text
producer: error/retry/batch/compression/throttle
broker: request queues, network/handler idle, bytes, partitions
replication: ISR shrink, under-replicated/offline, fetch lag
consumer: records/bytes, poll, rebalance, offset/lag age
KRaft: active controller, quorum lag, election
system: Page Cache, disk latency/space, network, GC
```

## 基准

固定 message/key/partition、acks、compression、batch、replication/min ISR、retention 和客户端。测可持续吞吐、P99、磁盘/网络、故障恢复，而非只跑 `producer-perf-test` 峰值。

## 故障矩阵

1. Broker/磁盘/网络故障，观察 ISR 和 leader；
2. Controller follower/leader 故障，保持多数派；
3. 单热 partition、磁盘满、证书过期；
4. Consumer 暂停、重平衡和下游慢；
5. 跨集群链路中断；
6. 滚动升级和回滚点。

每次写入带连续业务序号，验证缺口、重复、顺序和最大已确认位置。

## Runbook

```text
produce timeout → metadata/listener → request queue → leader/ISR → disk/network
consumer lag → production rate → assignment/rebalance → processing/downstream
URP → failed replica → fetch lag → disk/network/hot partition
disk full → retention/compaction/MM2/segment → add/move capacity safely
```

## 验收题

- Consumer lag 应用 offset 还是时间衡量？
- ISR shrink 为什么比 Broker alive 更重要？
- 峰值吞吐为何不能用于生产定容？
- 故障演练怎样证明零缺口或明确 RPO？

## 参考资料

- [Kafka monitoring](https://kafka.apache.org/40/operations/monitoring/)
- [Kafka operations](https://kafka.apache.org/40/operations/)
