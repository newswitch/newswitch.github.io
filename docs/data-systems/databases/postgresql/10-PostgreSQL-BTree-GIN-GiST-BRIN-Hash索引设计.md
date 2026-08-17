---
title: "B-Tree、GIN、GiST、BRIN、Hash 与索引设计"
sidebar_position: 10
tags: [PostgreSQL, Index, BTree, GIN, GiST, BRIN]
description: "按访问模式、排序、选择性、写放大和空间选择 PostgreSQL 索引。"
---

# B-Tree、GIN、GiST、BRIN、Hash 与索引设计

| 方法 | 擅长 | 典型场景 |
| --- | --- | --- |
| B-Tree | 等值、范围、排序 | 主键、时间范围、组合条件 |
| GIN | 一个值含多个 token | JSONB、Array、全文 |
| GiST | 可扩展空间/范围 | range、geometry、相似度 |
| BRIN | 物理顺序相关的大表 | 追加时间序列 |
| Hash | 等值 | 特定等值访问 |

## 组合索引

B-Tree 左侧列和排序决定可用性。按真实 WHERE、JOIN、ORDER BY 设计，等值列与范围/排序列顺序需用计划证明。`INCLUDE` 可覆盖返回列，但扩大索引和写成本。

Partial index 只索引满足稳定 predicate 的行；查询条件必须能被优化器证明蕴含 predicate。Expression index 加速表达式，但函数需满足可索引属性且写入会计算。

## 成本

每个索引增加 INSERT/UPDATE/DELETE、WAL、Vacuum、缓存和备份成本。低选择性列不一定无用，组合/partial 可能有效；高选择性也不保证优化器一定选择索引，若返回大量行顺序扫描可能更便宜。

## 安全创建

生产大表用 `CREATE INDEX CONCURRENTLY` 可减少阻塞，但耗时更长、资源更多，失败可能留下 invalid index。检查 `pg_stat_progress_create_index`、有效性并显式清理。

## 验收题

- BRIN 为什么小而不适合随机分布？
- INCLUDE 与把列放入 key 有何区别？
- 高选择性条件为何仍可能顺序扫描？
- 多余索引怎样影响 WAL 与 Vacuum？

## 参考资料

- [Index types](https://www.postgresql.org/docs/18/indexes-types.html)
- [Multicolumn indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html)
