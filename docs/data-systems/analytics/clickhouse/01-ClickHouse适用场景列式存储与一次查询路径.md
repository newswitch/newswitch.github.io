---
title: "ClickHouse 适用场景、列式存储与一次查询路径"
sidebar_position: 1
tags: [ClickHouse, OLAP, 列式存储, MergeTree, 查询执行]
description: "从 OLTP/OLAP 边界、Part 写入、列文件、稀疏索引、向量化 Pipeline 与分布式查询拆解 ClickHouse 数据路径。"
---

# ClickHouse 适用场景、列式存储与一次查询路径

ClickHouse 面向高吞吐写入和大规模分析查询：从大量行中读取少数列，完成过滤、分组、聚合、排序和近实时分析。它不是因为“SQL 很像数据库”就能直接替代 MySQL/PostgreSQL 的交易事务。

## 1. OLTP 与 OLAP 的差别

| 维度 | MySQL/PostgreSQL 常见 OLTP | ClickHouse 常见 OLAP |
| --- | --- | --- |
| 请求 | 少量行点查/更新 | 扫描大量行、聚合少数列 |
| 写入 | 单行事务、约束、并发修改 | 批量追加、后台合并 |
| 存储 | 行组织更利于整行访问 | 列组织利于裁列、压缩、向量化 |
| 索引 | 精确定位少量行 | 排序键 + 稀疏主键索引 + 跳数索引 |
| 一致性 | 复杂交易事务 | 分析数据新鲜度与最终收敛 |

典型链路：

```text
MySQL/PostgreSQL / application events
→ CDC or Kafka
→ batch insert into ClickHouse
→ dashboards / ad-hoc SQL / API aggregation
```

事务库保存事实，ClickHouse 保存适合分析的宽表或派生模型。必须设计去重、迟到事件、Schema 演进和可重建流程。

## 2. 为什么列式存储适合分析

查询：

```sql
SELECT region, sum(amount)
FROM orders
WHERE event_date >= today() - 7
GROUP BY region;
```

行式存储可能读取每行大量无关列；列式存储主要读取 `region`、`amount`、`event_date`。同一列类型和分布相近，也更容易压缩。更少的磁盘读取和更紧凑的数据让 CPU 能以块和向量方式执行。

但点查若无法利用排序键，仍可能扫描许多 granule；单行频繁更新/删除还会与 immutable part 和后台 merge 模型冲突。

## 3. 一批数据怎样写入 MergeTree

```text
Client INSERT batch
→ parse and type conversion
→ build column blocks
→ partition expression chooses partition
→ sort by ORDER BY key
→ write immutable data part
    ├─ compressed column files
    ├─ marks
    ├─ primary index entries
    └─ metadata/checksums
→ atomically expose part
→ background merge combines compatible parts
```

一次小 INSERT 也可能产生 part。持续大量小批会造成 parts explosion：元数据、文件、调度和 merge 压力上升，最终触发延迟或拒绝写入。因此写入批大小、频率、分区数量和 merge 能力必须共同设计。

Partition 主要服务数据生命周期和分区裁剪；`ORDER BY` 决定 part 内排序和稀疏主键索引，是查询性能的核心。把高基数字段直接作为分区键通常会制造过多分区和 part。

## 4. 一次本地查询路径

```text
SQL
→ parser / analyzer
→ logical and physical planning
→ partition pruning
→ sparse primary index selects mark ranges
→ optional data-skipping indexes prune granules
→ read required column ranges
→ decompress into blocks
→ vectorized filter / transform / aggregate
→ parallel pipeline stages
→ merge partial states
→ format and return
```

ClickHouse 的主键索引通常是稀疏索引：它帮助排除不可能包含结果的 granule，而不是像典型 B-Tree 那样为每行保存指针。查询条件越符合 `ORDER BY` 前缀和数据局部性，裁剪越有效。

`EXPLAIN indexes = 1`、查询日志和实际读取行/字节，能证明是否发生裁剪。看到 WHERE 条件并不意味着一定用了索引。

## 5. Pipeline 与并行为什么重要

执行计划被拆成读取、过滤、表达式、聚合、排序、合并和输出等 Processor，通过数据流 Pipeline 连接。多个线程处理不同 block 或 mark range，聚合先形成局部状态再合并。

并行度增加并不总能降低延迟：

- 小查询线程启动和协调成本可能占主导；
- 大聚合可能受内存和 Hash Table 限制；
- 排序/聚合溢出到磁盘会改变瓶颈；
- 并发查询过多会争夺 CPU、磁盘和 Page Cache；
- 返回结果过大时网络和客户端消费成为瓶颈。

因此容量规划要用真实并发和查询混合，而不是只跑单条最大 QPS。

## 6. 一次分布式查询

Distributed table 或显式集群查询大致是：

```text
initiator node
→ resolve shards and replicas
→ send subqueries to remote nodes
→ each node scans local MergeTree parts
→ partial aggregation/filtering
→ network transfer
→ initiator merges final result
```

瓶颈可能在慢 shard、远程连接、协调节点最终聚合、数据倾斜或跨机架网络。副本提供冗余与读扩展，但复制表数据、Distributed 路由和 ClickHouse Keeper 元数据协调属于不同层次。

## 7. 更新、删除与去重为何不同

传统 OLTP 倾向原地定位并更新少量行；ClickHouse 中 mutation 往往重写受影响数据 part，代价可能很大。ReplacingMergeTree 等引擎在后台 merge 时按规则保留版本，也不意味着每次普通查询立即只看到唯一最终行。

设计时应区分：

- 上游是否可能重复投递；
- 查询是否允许短暂重复；
- 是否在查询时使用 `FINAL`，它的代价是否可接受；
- 能否通过版本列、物化视图或离线修正收敛；
- 数据生命周期是否用 TTL/分区删除解决。

## 8. 第一轮观测

| 现象 | 关键证据 |
| --- | --- |
| 查询慢 | `system.query_log`、read_rows/read_bytes、ProfileEvents、内存 |
| 裁剪差 | `EXPLAIN`、排序键、过滤条件、parts/granules |
| 写入被拒 | active parts、small inserts、merge backlog、磁盘空间 |
| CPU 高 | 解压、表达式、Hash 聚合、并发和线程数 |
| CPU 低但慢 | 磁盘、远端 shard、队列、限额、网络、客户端读取 |
| 磁盘增长 | parts、replica、mutation、TTL、压缩率、临时文件 |

## 9. 最小实验

建立一个按日期分区、按 `(tenant_id, event_time)` 排序的 MergeTree 表：

1. 分别用单行和批量插入同样数量数据，比较 part 数；
2. 查询排序键前缀和非排序列，比较读取行/字节；
3. 查看 `system.parts` 与 `system.query_log`；
4. 修改查询并发和线程限制，观察吞吐与 P99 而非只看单次时延；
5. 在实验环境等待/触发合并，观察 part 变化，避免在生产盲目 `OPTIMIZE FINAL`。

## 10. 验收问题

- 列式存储为什么适合读少数列的大扫描？
- Partition、ORDER BY 与 Primary Key 分别解决什么？
- 为什么小批高频 INSERT 会导致 parts 问题？
- 稀疏主键索引与逐行 B-Tree 有什么不同？
- 查询 CPU 不高但 P99 很高，可能卡在哪些 Pipeline/分布式阶段？
- ReplacingMergeTree 为什么不等于实时唯一约束？

## 11. 参考资料

- [ClickHouse 架构概览](https://clickhouse.com/docs/architecture/introduction)
- [MergeTree 表引擎](https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree)
- [查询执行计划与 Pipeline](https://clickhouse.com/docs/optimize/query-optimization)
- [System tables](https://clickhouse.com/docs/operations/system-tables)
