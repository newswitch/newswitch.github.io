---
title: "Replacing/Summing/Aggregating/Collapsing MergeTree 语义"
sidebar_label: "05. Replacing/Summing/Aggregating/Collapsing MergeTree 语义"
sidebar_position: 5
tags: [ClickHouse, ReplacingMergeTree, AggregatingMergeTree]
description: "理解 MergeTree 家族在后台合并时去重、求和、聚合和折叠的最终语义。"
---

# Replacing/Summing/Aggregating/Collapsing MergeTree 语义

这些引擎多数在后台 Merge 时收敛，不是写入时立即唯一/更新。

| 引擎 | 合并行为 | 适用 |
| --- | --- | --- |
| Replacing | 排序键相同保留某版本 | 幂等快照/最终去重 |
| Summing | 数值列求和 | 增量汇总 |
| Aggregating | 合并 AggregateFunction state | 预聚合 |
| Collapsing | Sign 成对折叠 | 状态变更流 |
| VersionedCollapsing | 加 Version 处理乱序 | 乱序折叠 |

## Replacing

版本列越大通常胜出，但 Merge 前查询可能看到多行。`FINAL` 在查询时合并语义，成本可能高；更好地通过上游幂等、物化视图、分区和查询设计控制。

## Summing/Aggregating

Summing 只对可求和列按规则合并，其他列选择可能非直觉；Aggregating 存 state，查询使用对应 `...Merge` 函数。Schema 与物化视图必须配套。

## Collapsing

生产 +1、取消 -1 的顺序和完整性极重要。重复/缺失会得到错误状态；Version 仅帮助特定乱序，不替代事件幂等。

## 验收题

- Replacing 为什么不是实时唯一键？
- FINAL 的代价在哪里？
- Aggregating 表为何存 state 而非最终值？
- Collapsing 丢一个取消事件会怎样？

## 参考资料

- [MergeTree family](https://clickhouse.com/docs/engines/table-engines/mergetree-family)
