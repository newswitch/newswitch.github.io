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

配置 ver 列时，同一排序键按最大版本选择，但 Merge 前查询可能看到多行。`FINAL` 在查询时合并语义，成本可能高；更好地通过上游幂等、物化视图、分区和查询设计控制。

### 1.1 行身份、版本和收敛时机

设排序键为 id，Part A 有 `(id=7, ver=1, value=10)`，Part B 有 `(7,3,20)`。普通查询在二者合并前可看到两行；合并后该键保留 ver=3。去重身份是完整 `ORDER BY`，不是单独的 `PRIMARY KEY`。若把可变 value 也放入排序键，两行身份就不同，不会因为 id 一样被合并。[ReplacingMergeTree 规则](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/replacingmergetree)

后台只在同分区内合并；同一业务键分散到不同分区不能指望后台最终去重。查询 `FINAL` 是否跨分区处理还受相关设置影响，必须单独声明查询语义。没有 ver 或 ver 相同时也不能把插入顺序当业务版本协议，跨批次迟到需要上游定义版本。后台没有“某个固定秒数后必然收敛”的保证。

## 2. Summing/Aggregating {/* #summingaggregating */}

Summing 只对可求和列按规则合并，其他列选择可能非直觉；Aggregating 存 state，查询使用对应 `...Merge` 函数。Schema 与物化视图必须配套。

### 2.1 能合并的不是任意最终值 {/* #能合并的不是任意最终值 */}

设 φ 把一批原始行转换成聚合状态，⊕ 合并状态。要让分 Part、分线程、分片执行与一次全量聚合保持逻辑一致，需要满足：

```text
φ(X ∪ Y) = φ(X) ⊕ φ(Y)    // X、Y 为不重复的输入批次，∪ 表示多重集拼接
合并有单位元；分组方式改变时需要结合性
输入/合并次序任意时还需要交换性，或显式保留顺序
```

avg 的状态是 `(sum,count)`，不是最终平均数。第一批 1 行，值 10；第二批 9 行，均值 20。合并均值 `(10+20)/2=15` 是错的，合并状态得到 `(10+180)/(1+9)=19`。distinct 的两批集合 `{a,b}`、`{b,c}`，最终计数相加是 4，集合合并计数是 3；近似去重则合并对应 sketch。P99 也不能把两个分片的 P99 做平均。[Aggregate state 与 Merge combinators](https://clickhouse.com/docs/reference/functions/aggregate-functions/combinators)

Summing 的增量事实必须本身可加，重复输入仍会重复求和，不会自动幂等；Aggregating 保存可继续合并的状态，最终化应放在所有必要合并之后。浮点 sum 在实数上满足结合性，在机器舍入下未必逐 bit 相同，因此“逻辑可合并”不等于“任意合并树 bitwise 相等”。

## 3. Collapsing {/* #collapsing */}

生产 +1、取消 -1 的顺序和完整性极重要。重复/缺失会得到错误状态；Version 仅帮助特定乱序，不替代事件幂等。

### 3.1 用带符号增量还原状态

旧状态 value=10 对应 +1，撤销旧状态对应 -1、value=10，新状态 value=15 对应 +1。对正确成对的输入，`sum(Sign·value)=10-10+15=15`，`sum(Sign)=1`。如果取消事件丢失，结果变成 25、计数 2；多来一次新状态，则会变成 30、计数 2。Sign 不是能修复任意重复的事务日志。取消行的业务键和需要抵消的状态必须匹配，查询也必须遵守所选引擎的 sign/version 契约。

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
