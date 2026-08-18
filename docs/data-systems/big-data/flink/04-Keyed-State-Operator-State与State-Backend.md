---
title: "Flink Keyed State、Operator State 与 State Backend"
sidebar_label: "04. Flink Keyed State、Operator State 与 State Backend"
sidebar_position: 4
description: "理解状态类型、key-group、TTL、State Backend、本地恢复和状态容量治理。"
tags: [Flink State, Keyed State, State Backend]
---

# Flink Keyed State、Operator State 与 State Backend

状态使流作业能记住过去：聚合值、去重 ID、窗口、timer、模型或 source split。Flink 管理的状态可随 checkpoint 一致恢复和重分配；进程普通成员变量通常不具备这些保证。

## 1. 状态类型

- **Keyed State**：只能在 keyed stream 上访问，每个 key 独立，如 Value/List/Map/Reducing/Aggregating state；
- **Operator State**：绑定并行 operator 实例，如 source split；rescale 时按 union/even-split 等规则重分配；
- **Broadcast State**：规则流广播到所有实例，每份维护一致映射；
- **Timers**：按 processing/event time 注册，也属于需恢复的逻辑状态。

## 2. Key Group 与扩缩

Keyed state 先映射到 key-group，再由 operator subtask负责一组 key-group。恢复/扩缩时，系统迁移 key-group。这解释了 max parallelism 为什么影响未来扩容，也解释热 key 不能被一个 key-group 内进一步并行。

## 3. State Backend 与 Checkpoint Storage

Backend 决定运行时状态如何保存/访问（内存、managed memory、本地嵌入式 KV 等，具体实现随版本）；checkpoint storage 决定持久快照放在哪里。二者不是同一配置。

选择依据：状态大小、访问模式、延迟、checkpoint 增量能力、恢复、磁盘和运维。大状态使用本地盘时要规划 IOPS/容量，持久 checkpoint应在可靠对象/文件存储。

## 4. TTL

TTL 防状态无限增长，但语义需明确：基于何种时间、何时刷新、过期何时物理清理、snapshot/查询是否过滤。TTL 小于最大迟到或重放窗口会让历史重复重新生效。

估算：

```text
state_size ≈ 活跃key数 × 每key状态字节 × 存储放大
```

Map/List 中每元素和序列化/索引也有开销，应从 checkpoint/state metric 实测。

## 5. Schema 与 UID

状态序列化 schema、operator UID 和拓扑映射决定 savepoint/checkpoint 能否恢复。生产为有状态 operator 设置稳定 UID；字段/类型变化先做兼容测试和迁移方案。随意改算子名字、max parallelism 或 serializer 可能使状态无法映射。

## 6. 热状态

单热 key 导致某 subtask 状态、CPU、timer 与 checkpoint 长尾。增加并行度无法拆一个 key。使用更细业务 key、两阶段聚合、热点分流或异步外部状态前，要验证一致性和延迟。

## 7. 指标与实验

记录每 operator/subtask state size、key/entry 数、timer、local disk、checkpoint full/incremental bytes、restore time 和 cache hit。构造均匀/倾斜 key，比较 state 分布；从 savepoint 扩缩并验证 key 聚合不变；修改 schema 前做副本恢复。

## 8. 掌握验收

- 区分 keyed/operator/broadcast state；
- 解释 key-group 与 rescale；
- 区分 runtime backend 和 checkpoint storage；
- 估算 TTL、key 数与状态容量；
- 用稳定 UID 和兼容测试完成状态升级。

上一篇：[Event Time 与 Watermark](./03-Event-Time-Watermark-Window与迟到数据.md)　下一篇：[Checkpoint、Barrier、Savepoint 与 Exactly-Once](./05-Checkpoint-Barrier-Savepoint与Exactly-Once.md)

## 9. 参考资料 {/* #参考资料 */}

- [Flink Stateful Stream Processing](https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/stateful-stream-processing/)
- [Flink State Backends](https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/state/state_backends/)
