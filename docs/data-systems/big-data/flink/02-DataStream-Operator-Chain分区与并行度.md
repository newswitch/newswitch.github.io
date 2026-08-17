---
title: Flink DataStream、Operator Chain、分区与并行度
sidebar_label: "02. Flink DataStream、Operator Chain、分区与并行度"
sidebar_position: 2
tags: [Flink, DataStream, Operator Chain, Parallelism]
description: 理解 DataStream 转换、keyBy/rebalance/rescale/broadcast、算子链和端到端并行度匹配。
---

# Flink DataStream、Operator Chain、分区与并行度

Flink 作业性能首先取决于每条边如何分区、每个 operator 的并行度，以及是否 chain。`keyBy` 不是普通函数，它会按 key 重新分区，让相同 key 的事件和 keyed state 到同一 subtask。

## 1. Transformation

Source 产生 DataStream，经 map/filter/flatMap、keyBy、window/process、sink。无状态操作易扩展；有状态操作需要定义 key、状态生命周期和恢复。

## 2. 分区方式

| 方式 | 含义 | 风险 |
|---|---|---|
| forward | 上下游并行度相同时一对一 | 并行度改变时不可直接沿用 |
| rebalance | round-robin 均匀分发 | 相同 key 不聚合 |
| rescale | 局部 round-robin | 分布取决于上下游映射 |
| keyBy | key hash/key-group 分配 | 热 key 倾斜 |
| broadcast | 每条发到全部下游 | 流量和状态复制放大 |
| custom | 自定义规则 | 演进、状态与正确性复杂 |

选择依据是语义，不是只为“均匀”。聚合前必须 keyBy，广播规则流应控制大小和更新一致性。

## 3. Operator Chain

兼容的上下游算子可 chain 到同一 task/thread，减少序列化、网络和 buffer。Chain 也让 CPU/指标/故障边界合并：一个慢 map 会拖住整个 chain，单独扩缩其中算子较难。

只有在隔离资源、定位性能或改变并行度确有需要时拆 chain；拆开会增加网络和序列化，必须基准证明。

## 4. Parallelism 与 Max Parallelism

Operator parallelism 是运行 subtask 数；keyed state 按 key-group 分片，key-group 数由 max parallelism 约束。Rescale 时 key-group 在新 subtask 间重新分配。Max parallelism 规划过低会限制未来扩容，随意改变又影响状态兼容。

## 5. Source 到 Sink 匹配

```text
Kafka partitions -> source parallelism -> keyBy subtasks
-> state size/subtask -> sink writers -> files/transactions
```

Kafka 24 partitions，source 并行 48 时部分 subtask 可能无有效分区；sink 并行 128 且 checkpoint 频繁时可能制造小文件。局部吞吐提高不能以状态长尾和下游元数据爆炸为代价。

## 6. Async I/O

外部维表查询若同步阻塞，会让 operator 低 CPU 但低吞吐。Async I/O 用有界并发隐藏延迟，但要设置 timeout、容量和 ordered/unordered 语义。外部服务必须有配额和熔断，不能把延迟转成无限在途请求。

## 7. 指标与实验

逐 operator 查看 records in/out、busy/idle/backpressured、watermark、state、latency；逐 subtask 比较 max/median。用相同 workload 对比 chain/拆 chain、rebalance/keyBy 和并行度，记录网络字节、吞吐、checkpoint 与输出文件数。

## 8. 掌握验收

- 根据语义选择 keyBy、rebalance、broadcast；
- 解释 chain 的收益与观测/扩缩代价；
- 区分 parallelism 与 max parallelism；
- 从 Kafka partition 追到 sink writer；
- 用 subtask 分布识别热 key 而非只看平均值。

上一篇：[Flink 架构与 Slot](./01-Flink架构JobManager-TaskManager与Slot.md)　下一篇：[Event Time、Watermark、Window 与迟到数据](./03-Event-Time-Watermark-Window与迟到数据.md)

## 参考资料

- [Flink DataStream Operators](https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/overview/)
