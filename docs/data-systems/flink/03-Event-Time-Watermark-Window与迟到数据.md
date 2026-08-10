---
title: Flink Event Time、Watermark、Window 与迟到数据
sidebar_position: 3
tags: [Flink, Event Time, Watermark, Window]
description: 从事件时间与乱序出发设计 Watermark、窗口触发、允许迟到和状态清理。
---

# Flink Event Time、Watermark、Window 与迟到数据

事件在 10:00 发生，不代表 10:00 到达 Flink。网络、Kafka 积压和重启会造成乱序。Event Time 让计算按业务发生时间归属窗口，Watermark 是系统对“事件时间大致推进到哪里”的分布式进度判断。

## 1. 三种时间

- Event time：事件真正发生时间；
- Ingestion/append time：进入平台/Kafka 的时间；
- Processing time：算子处理时机器时间。

业务口径应明确时区、字段和异常时间戳处理。未来时间戳可能把 watermark 错误推进，极旧时间戳可能污染状态。

## 2. Watermark

对有界乱序策略，watermark 通常落后观察到的最大事件时间一段容忍。并行 source 的下游 watermark 受较慢/较小输入影响；空闲 partition 若未正确标记 idle，可能阻止全局推进。

Watermark 不保证更早事件不会到达，而是决定窗口触发和状态生命周期。容忍越大，完整性更好但延迟和状态更高。

## 3. Window

- Tumbling：固定、不重叠；
- Sliding：固定、可重叠，计算/状态放大；
- Session：按活动间隔合并；
- Global/自定义：需自行定义 trigger/evictor 等语义。

Window assigner 决定属于哪个窗口，trigger 决定何时计算，process/aggregate 决定保存什么状态。可增量聚合时不要保存全部事件。

## 4. 迟到数据

窗口首次触发后到达的事件可能：

- 在 allowed lateness 内更新结果；
- 输出到 side output 供补偿；
- 被丢弃并计数；
- 写明细表，稍后批处理重算。

Sink 必须能表达更新/撤回或幂等覆盖。若只 append，窗口更新会产生多个版本，消费方需知道取最终值。

## 5. 多流 Join

两条流速度不同，Join 状态需要时间边界和双方 watermark。无时间条件的持续 Join 会无限保存历史。维表更新还需选择 temporal/versioned 语义，防用未来版本关联过去事件。

## 6. 调试

同时观测各 source/subtask watermark、current event-time lag、idle partition、late records、window/timer/state 数和输出更新。全局 watermark 卡住时定位最慢输入，不要只调大容忍。

## 7. 实验

发送按 `10:00,10:02,10:01,09:50` 顺序到达的事件，分别设置不同乱序/迟到范围，记录首次触发、更新、side output 和最终 count。停止一个输入 partition，观察 idle 配置对 watermark 的影响。

## 8. 掌握验收

- 区分事件、摄取与处理时间；
- 解释 watermark 是进度判断而非完整性承诺；
- 为 tumbling/sliding/session 选择状态与触发；
- 设计迟到更新、隔离或批量校正；
- 定位 idle partition 导致的 watermark 卡住。

上一篇：[DataStream 分区与并行度](./02-DataStream-Operator-Chain分区与并行度.md)　下一篇：[Keyed State、Operator State 与 State Backend](./04-Keyed-State-Operator-State与State-Backend.md)

## 参考资料

- [Flink Event Time and Watermarks](https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/time/)
