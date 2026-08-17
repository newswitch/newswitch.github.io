---
title: "SQL、CTE、Window、JSONB、Array 与全文检索"
sidebar_label: "05. SQL、CTE、Window、JSONB、Array 与全文检索"
sidebar_position: 5
tags: [PostgreSQL, SQL, CTE, Window, JSONB]
description: "系统掌握 PostgreSQL 高级 SQL，并用执行计划约束表达力带来的成本。"
---

# SQL、CTE、Window、JSONB、Array 与全文检索

## 查询处理顺序

概念顺序是 FROM/JOIN → WHERE → GROUP → HAVING → Window → SELECT → ORDER/LIMIT。理解它能解释别名可见范围和聚合后窗口计算。

## CTE

CTE 提高可读性、支持递归；目标版本中优化器可能 inline，也可用 `MATERIALIZED/NOT MATERIALIZED` 控制部分行为。物化会保存中间结果并形成优化边界，需用 `EXPLAIN` 证明收益。

## Window

Window 不合并行，在分区内计算排名、累计、前后值：

```sql
sum(amount) OVER (PARTITION BY account_id ORDER BY ts
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

明确 `ROWS/RANGE/GROUPS` frame；默认 frame 可能让 `last_value` 结果出乎预期。排序可能占用 work_mem 并溢出磁盘。

## JSONB 与 Array

JSONB 适合半结构扩展和局部查询，但核心约束/高频 Join 字段仍应结构化。GIN 索引能加速包含/路径查询，却增加写放大和空间。Array 适合小型整体属性，不适合无限增长的一对多关系。

## 全文检索

文本经 configuration 生成 `tsvector`，查询生成 `tsquery`，GIN 常用于索引。语言、词典、权重和排名需业务评测；复杂跨字段搜索、大规模聚合再比较 Elasticsearch。

## 排障证据

使用 `EXPLAIN (ANALYZE, BUFFERS, WAL)`（写语句需事务回滚/测试环境）检查行数估算、Sort/Hash spill、GIN recheck、函数和返回字节。

## 验收题

- CTE 何时成为物化边界？
- Window 与 GROUP BY 的输出行数有何不同？
- JSONB 为什么不是免设计 Schema？
- 全文检索何时应转向 Elasticsearch？

## 参考资料

- [Queries](https://www.postgresql.org/docs/18/queries.html)
- [Window functions](https://www.postgresql.org/docs/18/functions-window.html)
- [JSON](https://www.postgresql.org/docs/18/datatype-json.html)
