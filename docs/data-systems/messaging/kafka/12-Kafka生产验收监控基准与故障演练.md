---
title: "生产验收、监控告警、基准测试与故障演练"
sidebar_label: "12. 生产验收、监控告警、基准测试与故障演练"
sidebar_position: 12
description: "建立 Kafka 从端到端 SLO、容量和监控到 Broker/Controller/磁盘故障演练的验收体系。"
tags: [Kafka, Monitoring, Benchmark, Runbook]
---

# 生产验收、监控告警、基准测试与故障演练

## 1. SLO {/* #slo */}

分别定义 Produce 成功/端到端延迟、Consumer lag 时间、可用性、数据缺口和重复容忍。Broker request latency 不等于消息业务完成时间。

## 2. 监控 {/* #监控 */}

```text
producer: error/retry/batch/compression/throttle
broker: request queues, network/handler idle, bytes, partitions
replication: ISR shrink, under-replicated/offline, fetch lag
consumer: records/bytes, poll, rebalance, offset/lag age
KRaft: active controller, quorum lag, election
system: Page Cache, disk latency/space, network, GC
```

## 3. 基准 {/* #基准 */}

固定 message/key/partition、acks、compression、batch、replication/min ISR、retention 和客户端。测可持续吞吐、P99、磁盘/网络、故障恢复，而非只跑 `producer-perf-test` 峰值。

## 4. 故障矩阵 {/* #故障矩阵 */}

1. Broker/磁盘/网络故障，观察 ISR 和 leader；
2. Controller follower/leader 故障，保持多数派；
3. 单热 partition、磁盘满、证书过期；
4. Consumer 暂停、重平衡和下游慢；
5. 跨集群链路中断；
6. 滚动升级和回滚点。

每次写入带连续业务序号，验证缺口、重复、顺序和最大已确认位置。

## 5. Runbook {/* #runbook */}

```text
produce timeout → metadata/listener → request queue → leader/ISR → disk/network
consumer lag → production rate → assignment/rebalance → processing/downstream
URP → failed replica → fetch lag → disk/network/hot partition
disk full → retention/compaction/MM2/segment → add/move capacity safely
```

## 6. Kafka 4.x 生产验收清单 {/* #kafka-4x-生产验收清单 */}

当前新集群以 KRaft 为前提。验收记录必须包含 Kafka/Java/客户端版本、controller/broker 拓扑、listener、磁盘、网络、Topic 参数和测试数据模型，确保结果可复现。

```text
功能：produce/consume、幂等/事务、ACL允许与拒绝
性能：峰值写入/读取、P95/P99、吞吐、CPU/磁盘/网络
可靠性：单 broker、单 controller、单盘、单可用区故障
恢复：ISR 收敛、leader 选举、消费者恢复、数据序号对账
变更：滚动升级、证书轮换、扩分区/扩 broker、回滚边界
```

核心告警围绕用户影响和耗尽：produce/fetch error、端到端延迟、consumer lag 及增长率、URP/offline partition、ISR shrink、controller quorum、request queue、磁盘水位。故障演练期间设置停止线，禁止同时做 reassignment、升级和大规模 compaction。

基准报告同时给出平均消息大小、压缩、acks、batch、分区、并发和复制因子；只给“每秒多少条”没有可迁移意义。上线后用真实流量重新校准，并把所有破坏性操作写成有前置检查、证据、回滚和验收的 Runbook。

## 7. 验收题 {/* #验收题 */}

- Consumer lag 应用 offset 还是时间衡量？
- ISR shrink 为什么比 Broker alive 更重要？
- 峰值吞吐为何不能用于生产定容？
- 故障演练怎样证明零缺口或明确 RPO？

## 8. 参考资料 {/* #参考资料 */}

- [Kafka monitoring](https://kafka.apache.org/40/operations/monitoring/)
- [Kafka operations](https://kafka.apache.org/40/operations/)
