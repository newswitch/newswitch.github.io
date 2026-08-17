---
title: "SELECT Pipeline、向量化、PREWHERE、Join 与聚合"
sidebar_position: 6
tags: [ClickHouse, Query Pipeline, PREWHERE, Join]
description: "从解析、裁剪、列读取到并行 Pipeline、Join、聚合和输出定位查询成本。"
---

# SELECT Pipeline、向量化、PREWHERE、Join 与聚合

```text
parse/analyze/plan
→ partition/index pruning
→ parallel read ranges
→ PREWHERE/filter
→ expression/join/aggregate/sort
→ merge streams → format/output
```

ClickHouse 按 Block 批量处理列，减少解释和分支成本。`max_threads` 控制部分并行，不代表每查询固定线程数。

## PREWHERE

先读取选择性过滤列，确定行后再读其余列，降低 I/O。优化器可自动移动条件；用 EXPLAIN 和 read bytes 证明。过滤列很宽/选择性差时收益有限。

## Join

Hash/parallel hash、merge、direct、grace hash 等算法在内存、排序、外部存储和字典访问间权衡。小表放右侧/字典并非万能，需考虑分布式数据搬运和重复键语义。

## 聚合

Hash table 按 key 基数增长；two-level aggregation、partial merge 和 external spill 控制内存。`GROUP BY` 高基数、`uniqExact`、大状态函数和并发会触发 OOM/落盘。

## 排障

用 `EXPLAIN PIPELINE`、query_log/ProfileEvents、read_rows/bytes、memory_usage、temporary files 定位。返回亿行时客户端/网络是瓶颈，先限制结果。

## 验收题

- 向量化执行与向量数据库有什么区别？
- PREWHERE 为什么能少读列？
- 高基数聚合如何耗尽内存？
- max_threads 越大为何不一定更快？

## 参考资料

- [Query optimization](https://clickhouse.com/docs/optimize/query-optimization)
- [EXPLAIN](https://clickhouse.com/docs/sql-reference/statements/explain)
