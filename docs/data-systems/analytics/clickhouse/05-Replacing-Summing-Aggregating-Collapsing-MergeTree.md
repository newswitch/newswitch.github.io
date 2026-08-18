---
title: "Replacing/Summing/Aggregating/Collapsing MergeTree 语义"
sidebar_label: "05. Replacing/Summing/Aggregating/Collapsing MergeTree 语义"
sidebar_position: 5
description: "理解 MergeTree 家族在后台合并时去重、求和、聚合和折叠的最终语义。"
tags: [ClickHouse, ReplacingMergeTree, AggregatingMergeTree]
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

## 1. Replacing {/* #replacing */}

版本列越大通常胜出，但 Merge 前查询可能看到多行。`FINAL` 在查询时合并语义，成本可能高；更好地通过上游幂等、物化视图、分区和查询设计控制。

## 2. Summing/Aggregating {/* #summingaggregating */}

Summing 只对可求和列按规则合并，其他列选择可能非直觉；Aggregating 存 state，查询使用对应 `...Merge` 函数。Schema 与物化视图必须配套。

## 3. Collapsing {/* #collapsing */}

生产 +1、取消 -1 的顺序和完整性极重要。重复/缺失会得到错误状态；Version 仅帮助特定乱序，不替代事件幂等。

## 4. 选择引擎前先验证最终语义 {/* #选择引擎前先验证最终语义 */}

为每种引擎构造重复、乱序、撤销和分区边界数据，分别在 merge 前后查询。`FINAL` 可以在查询时完成额外合并语义，但成本可能很高，不应成为所有线上查询的默认补丁。

```sql
OPTIMIZE TABLE replacing_lab PARTITION <partition> FINAL;
SELECT * FROM system.merges WHERE table = 'replacing_lab';
```

ReplacingMergeTree 是最终去重，不保证写入即唯一；Summing/Aggregating 只对符合契约的列/状态聚合；Collapsing 的 sign/version 顺序错误会产生难解释结果。业务必须定义幂等键、版本、迟到窗口和“何时可认为结果收敛”。

对账至少比较原始事件数、唯一业务键、聚合结果和异常行。若需要强唯一约束和同步事务更新，ClickHouse 可能不是权威写库，应由上游数据库保证并通过 CDC 投影。

## 5. 验收题 {/* #验收题 */}

- Replacing 为什么不是实时唯一键？
- FINAL 的代价在哪里？
- Aggregating 表为何存 state 而非最终值？
- Collapsing 丢一个取消事件会怎样？

## 6. 参考资料 {/* #参考资料 */}

- [MergeTree family](https://clickhouse.com/docs/engines/table-engines/mergetree-family)
