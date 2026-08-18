---
title: "B-Tree、GIN、GiST、BRIN、Hash 与索引设计"
sidebar_label: "10. B-Tree、GIN、GiST、BRIN、Hash 与索引设计"
sidebar_position: 10
description: "按访问模式、排序、选择性、写放大和空间选择 PostgreSQL 索引。"
tags: [PostgreSQL, Index, BTree, GIN, GiST, BRIN]
---

# B-Tree、GIN、GiST、BRIN、Hash 与索引设计

| 方法 | 擅长 | 典型场景 |
| --- | --- | --- |
| B-Tree | 等值、范围、排序 | 主键、时间范围、组合条件 |
| GIN | 一个值含多个 token | JSONB、Array、全文 |
| GiST | 可扩展空间/范围 | range、geometry、相似度 |
| BRIN | 物理顺序相关的大表 | 追加时间序列 |
| Hash | 等值 | 特定等值访问 |

## 1. 组合索引 {/* #组合索引 */}

B-Tree 左侧列和排序决定可用性。按真实 WHERE、JOIN、ORDER BY 设计，等值列与范围/排序列顺序需用计划证明。`INCLUDE` 可覆盖返回列，但扩大索引和写成本。

Partial index 只索引满足稳定 predicate 的行；查询条件必须能被优化器证明蕴含 predicate。Expression index 加速表达式，但函数需满足可索引属性且写入会计算。

## 2. 成本 {/* #成本 */}

每个索引增加 INSERT/UPDATE/DELETE、WAL、Vacuum、缓存和备份成本。低选择性列不一定无用，组合/partial 可能有效；高选择性也不保证优化器一定选择索引，若返回大量行顺序扫描可能更便宜。

## 3. 安全创建 {/* #安全创建 */}

生产大表用 `CREATE INDEX CONCURRENTLY` 可减少阻塞，但耗时更长、资源更多，失败可能留下 invalid index。检查 `pg_stat_progress_create_index`、有效性并显式清理。

## 4. 用查询与写入共同选择索引 {/* #用查询与写入共同选择索引 */}

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)
SELECT * FROM events WHERE tenant_id = 10 AND created_at >= now() - interval '1 day';

SELECT schemaname, relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes WHERE relname = 'events';
```

对 B-tree、GIN/GiST、BRIN 候选使用相同数据分布和查询集，比较计划、buffers、P99、索引大小与 INSERT/UPDATE WAL 放大。BRIN 依赖物理相关性，GIN 适合多值/全文但更新成本更高；Hash、GiST 也各有操作符类边界。

索引是否“未使用”要跨完整业务周期判断，主键/唯一约束和灾备查询不能只看 `idx_scan` 删除。生产创建大索引优先评估 `CREATE INDEX CONCURRENTLY`，但它耗时更长且失败后可能留下 invalid index；监控 `pg_stat_progress_create_index` 并准备清理。

## 5. 验收题 {/* #验收题 */}

- BRIN 为什么小而不适合随机分布？
- INCLUDE 与把列放入 key 有何区别？
- 高选择性条件为何仍可能顺序扫描？
- 多余索引怎样影响 WAL 与 Vacuum？

## 6. 参考资料 {/* #参考资料 */}

- [Index types](https://www.postgresql.org/docs/18/indexes-types.html)
- [Multicolumn indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html)
