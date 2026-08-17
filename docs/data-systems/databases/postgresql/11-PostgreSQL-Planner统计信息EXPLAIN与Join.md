---
title: "Planner、统计信息、EXPLAIN ANALYZE 与 Join"
sidebar_label: "11. Planner、统计信息、EXPLAIN ANALYZE 与 Join"
sidebar_position: 11
tags: [PostgreSQL, Planner, EXPLAIN, Join]
description: "从基数估算到扫描与 Join 选择，建立 PostgreSQL 慢 SQL 证据链。"
---

# Planner、统计信息、EXPLAIN ANALYZE 与 Join

Planner 枚举可行路径，以统计估算行数和成本选择计划；Executor 执行。慢 SQL 常从某个节点 `estimated rows` 与 `actual rows` 大幅偏差开始。

## 统计信息

ANALYZE 收集 null fraction、distinct、MCV、histogram 和相关性。列之间相关导致独立性假设失真时，可建立 extended statistics（dependencies/ndistinct/MCV）。统计目标越高，ANALYZE 与 catalog 成本越大。

## Join

| 算法 | 适合 | 风险 |
| --- | --- | --- |
| Nested Loop | 外表小、内表有索引 | 行数低估后重复扫描巨大 |
| Hash Join | 等值、大输入 | Hash 超内存批次落盘 |
| Merge Join | 已排序/范围兼容 | 排序成本和输入规模 |

## EXPLAIN

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, VERBOSE)
SELECT ...;
```

`ANALYZE` 真正执行语句，写操作只在可回滚测试事务/环境使用。逐节点看 actual time/loops/rows、Rows Removed、Heap Fetches、Buffers、Sort Method、temp read/write 和 WAL。

## 参数化计划

Prepared statement 可能在 custom 与 generic plan 间选择。数据倾斜时一个通用计划不适合所有参数，需用 `pg_stat_statements` 和带代表值的计划比较，不能全局禁用缓存。

## 定位流程

```text
top SQL by total time/P99
→ capture exact SQL+bind shape
→ explain with realistic data/cache
→ first large estimate error or spill
→ statistics/schema/query/index fix
→ regression benchmark
```

## 验收题

- 估算错误为什么会改变 Join 顺序？
- Hash Join 什么时候落盘？
- `EXPLAIN ANALYZE` 的 loops 怎样解读？
- Generic plan 为什么可能拖慢倾斜参数？

## 参考资料

- [Using EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)
- [Planner statistics](https://www.postgresql.org/docs/18/planner-stats.html)
