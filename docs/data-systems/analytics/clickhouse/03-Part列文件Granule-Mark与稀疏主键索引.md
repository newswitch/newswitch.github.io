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

### 1.1 手算一次 mark range 裁剪

设一个 Part 的单列排序键为 1 到 16，每个 granule 恰好 4 行，主键索引记录起始键 1、5、9、13。查询 `7 <= key < 10` 的真实结果是 7、8、9，但候选读取区间覆盖 `[5,8]` 与 `[9,12]` 两个 granule：读取 8 行，再逐行过滤得到 3 行，行读放大是 `8/3`。这是按固定粒度构造的教学模型；实际边界、最终 mark 与自适应粒度以实现为准。[Primary indexes](https://clickhouse.com/docs/concepts/core-concepts/primary-indexes)

主键索引用键值判断哪些范围可能匹配；mark 再把逻辑位置映射到列文件的压缩块位置和块内偏移。两个 granule 可能共用一个压缩块，读取一个逻辑范围不一定只解压对应行。因此 `selected granules`、`read_rows` 和物理磁盘字节不是同一个量，不能把 granule 数直接乘一个固定磁盘字节数。

## 2. ORDER BY {/* #order-by */}

排序键前缀与高频过滤/聚合、数据局部性匹配。低基数/常用过滤常放前面，高基数时间/ID 再细化；具体顺序用 `EXPLAIN indexes=1` 和 read_rows/read_bytes 验证。

### 2.1 字典序为何强调前缀

对 `(tenant, ts)`，同一个 tenant 内时间有序；固定 tenant 后限制时间，通常只覆盖它内部的连续段。仅查时间时，每个 tenant 都可能有满足条件的段，不能按全 Part 的时间单调性只保留一段。非前缀条件不等于绝对无法跳读，但稀疏边界能证明排除的范围更少；分区摘要、skip index 和实际数据分布还会改变结果。

主键是排序键的前缀时，排序列可以比稀疏索引列更多。`ORDER BY` 控制数据局部性和引擎合并身份，`PRIMARY KEY` 控制哪些键进入稀疏索引；二者不是关系数据库里唯一约束和行定位键的同义词。

## 3. Granule {/* #granule */}

更小粒度提高裁剪精度但增加 mark/index 元数据和 seek；更大粒度相反。自适应粒度和压缩由版本/设置决定，不应脱离真实行宽调参。

### 3.1 元数据与读放大的交换

固定 N 行、每 granule g 行时，mark 数约 `ceil(N/g)`。若每个索引边界和各列 mark 合计 h 字节，相关元数据约 `h·ceil(N/g)`；将 g 减半大致使这部分翻倍。窄范围查询可少读边界两侧无关行，但若查询本来扫描全部数据，几乎没有省下行读取，反而多了元数据。宽行可触发字节阈值形成较小 granule，所以“默认多少行”并不保证每个 granule 都有相同大小。

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
