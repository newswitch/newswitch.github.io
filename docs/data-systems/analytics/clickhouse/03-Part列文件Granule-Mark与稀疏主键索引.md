---
title: "Part、Column File、Granule、Mark 与稀疏主键索引"
sidebar_label: "03. Part、Column File、Granule、Mark 与稀疏主键索引"
sidebar_position: 3
description: "理解 MergeTree Part 内列文件、压缩块、Granule、Mark 和稀疏索引裁剪。"
tags: [ClickHouse, Part, Granule, Mark, Primary Index]
---

# Part、Column File、Granule、Mark 与稀疏主键索引

每批插入形成 immutable Part，行按 `ORDER BY` 排序，各列独立压缩存储。Granule 是读取/索引基本粒度，Mark 指向压缩数据位置，主键索引为每个 Granule 保存稀疏键值。

```text
partition
→ parts
  → column data + marks + primary.idx + metadata/checksum
```

## 1. 查询裁剪 {/* #查询裁剪 */}

Partition pruning 先排除分区，Primary Key 条件再排除 mark ranges，Skip Index 可进一步跳过 Granule，PREWHERE 先读少量过滤列。稀疏索引不能像逐行 B-Tree 精确定位任意行。

## 2. ORDER BY {/* #order-by */}

排序键前缀与高频过滤/聚合、数据局部性匹配。低基数/常用过滤常放前面，高基数时间/ID 再细化；具体顺序用 `EXPLAIN indexes=1` 和 read_rows/read_bytes 验证。

## 3. Granule {/* #granule */}

更小粒度提高裁剪精度但增加 mark/index 元数据和 seek；更大粒度相反。自适应粒度和压缩由版本/设置决定，不应脱离真实行宽调参。

## 4. 观察 {/* #观察 */}

查询 `system.parts`、`system.columns`、query_log，比较压缩前后字节、Part/row/marks；禁止手工修改 Part 文件。

## 5. 从 EXPLAIN 证明跳读 {/* #从-explain-证明跳读 */}

```sql
EXPLAIN indexes = 1
SELECT count() FROM events
WHERE tenant = 'a' AND ts >= now() - INTERVAL 1 HOUR;

SELECT name, rows, marks, bytes_on_disk, primary_key_bytes_in_memory
FROM system.parts WHERE table = 'events' AND active ORDER BY rows DESC;
```

用同一批数据建立两张不同 `ORDER BY` 的表，比较读 marks/rows/bytes 和 P99。稀疏主键索引只记录 granule 边界，不是关系数据库的一行一个 B-Tree 入口；条件无法匹配排序键前缀时会读取更多 granule。

大量小 part 会增加 metadata、打开文件和 merge 压力。排障时把 `system.query_log` 的 read_rows/read_bytes 与 `system.parts`、磁盘延迟对应；不要看到“有主键”就认定查询已经使用索引。

## 6. 验收题 {/* #验收题 */}

- 为什么 ClickHouse 主键不是唯一约束？
- Mark 指向什么？
- ORDER BY 前缀如何影响裁剪？
- Granule 太小的代价是什么？

## 7. 参考资料 {/* #参考资料 */}

- [MergeTree storage](https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree)
