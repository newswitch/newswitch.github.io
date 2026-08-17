---
title: "Projection、Materialized View、Skip Index 与 Query Cache"
sidebar_label: "07. Projection、Materialized View、Skip Index 与 Query Cache"
sidebar_position: 7
tags: [ClickHouse, Projection, Materialized View, Skip Index]
description: "按查询形状选择投影、物化视图、跳数索引和缓存，理解写放大与一致性。"
---

# Projection、Materialized View、Skip Index 与 Query Cache

| 能力 | 解决问题 | 代价 |
| --- | --- | --- |
| Projection | 同表替代排序/预聚合布局 | 存储、写入、物化 |
| Materialized View | 写入时把 block 转入目标表 | 目标治理、历史回填 |
| Skip Index | Granule 级排除 | 元数据/写入，选择性依赖 |
| Query Cache | 重复查询结果 | 失效、新鲜度、内存 |

## Projection

优化器可选择 Projection，适合稳定高频查询。已有历史数据需 MATERIALIZE；执行前估算空间和 Merge 负载。

## Materialized View

它像 INSERT trigger 处理新写入 block，不会自动回填旧数据。源重试重复会流入目标，聚合目标需可合并状态/幂等设计。变更定义时用新目标表回填、双验证再切换。

## Skip Index

minmax、set、Bloom 等仅在数据与 Granule 有可跳过特征时有效。随机高基数导致 Bloom 过大或命中差。用 `EXPLAIN indexes=1` 证明 dropped granules。

## Cache

缓存适合相同查询和可接受新鲜度，不能掩盖错误排序键。监控命中、容量和查询参数高基数。

## 验收题

- Materialized View 为什么不回填旧行？
- Projection 与 MV 的目标存储边界有何不同？
- Skip Index 为什么不是二级 B-Tree？
- Query Cache 如何影响实时数据可见体验？

## 参考资料

- [Projections](https://clickhouse.com/docs/data-modeling/projections)
- [Materialized views](https://clickhouse.com/docs/materialized-view)
