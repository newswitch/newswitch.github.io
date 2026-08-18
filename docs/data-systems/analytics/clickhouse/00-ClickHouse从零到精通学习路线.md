---
title: "ClickHouse 从零到精通学习路线"
sidebar_label: "00. ClickHouse 从零到精通学习路线"
sidebar_position: 0
description: "从列式存储和 MergeTree 深入 Part、稀疏索引、Merge、查询流水线、复制分片、Keeper、容量性能与生产故障排查。"
tags: [ClickHouse, OLAP, MergeTree, 列式存储, 学习路线]
---

# ClickHouse 从零到精通学习路线

ClickHouse 的“快”来自面向分析工作负载的列式存储、向量化执行、数据跳过、并行读取和压缩，不是所有 SQL 都天然快。错误的排序键、过多小 Part、低基数设计错误、分片键倾斜和 Merge 资源竞争，都会让集群从高吞吐变成持续抖动。

ClickHouse 按月快速发布，本路线不把某个补丁号永久写死；实验使用当前官方稳定分支的批准版本，并记录 Server、Client、Keeper、Operator/Chart 和驱动版本。

## 1. 数据路径

```text
INSERT block
  → parse / transform / sort by ORDER BY
  → immutable data Part
  → replication log / object or local storage
  → background Merge / mutation / TTL

SELECT
  → parse / analyze / optimize
  → choose Parts / marks / granules
  → parallel read columns
  → vectorized pipeline / aggregation
  → distributed merge
  → result
```

## 2. 篇文章规划 {/* #2-16-篇文章规划 */}

| 编号 | 文章 | 优先级 | 状态 |
| --- | --- | --- | --- |
| C00 | ClickHouse 从零到精通学习路线 | P0 | 已完成 |
| C01 | [ClickHouse 适用场景、列式存储与一次查询路径](./01-ClickHouse适用场景列式存储与一次查询路径.md) | P0 | 已完成 |
| C02 | [数据类型、Nullable、LowCardinality、Array/Map 与 Schema](./02-ClickHouse数据类型LowCardinality-Array-Map与Schema.md) | P0 | 已完成 |
| C03 | [Part、Column File、Granule、Mark 与稀疏主键索引](./03-Part列文件Granule-Mark与稀疏主键索引.md) | P0 | 已完成 |
| C04 | [MergeTree 分区、排序键与后台合并](../olap/02-ClickHouse-MergeTree分区排序键与后台合并.md) | P0 | 已完成 |
| C05 | [Replacing/Summing/Aggregating/Collapsing MergeTree 语义](./05-Replacing-Summing-Aggregating-Collapsing-MergeTree.md) | P0 | 已完成 |
| C06 | [SELECT Pipeline、向量化、PREWHERE、Join 与聚合](./06-SELECT-Pipeline向量化PREWHERE-Join与聚合.md) | P0 | 已完成 |
| C07 | [Projection、Materialized View、Skip Index 与 Query Cache](./07-Projection物化视图Skip-Index与Query-Cache.md) | P1 | 已完成 |
| C08 | [异步 INSERT、Batch、Kafka Engine、去重与一致性](./08-异步INSERT-Batch-Kafka-Engine去重与一致性.md) | P1 | 已完成 |
| C09 | [Package、Docker、ClickHouse Keeper 与多节点部署](./09-ClickHouse-Package-Docker-Keeper与多节点部署.md) | P0 | 已完成 |
| C10 | [ReplicatedMergeTree、Shard、Replica、Distributed Table 与路由](./10-ReplicatedMergeTree-Shard-Replica与Distributed-Table.md) | P0 | 已完成 |
| C11 | [Keeper/Raft、复制队列、选主、故障恢复和扩缩容](./11-Keeper-Raft复制队列故障恢复与扩缩容.md) | P1 | 已完成 |
| C12 | [Merge、Mutation、TTL、小 Part、磁盘与对象存储治理](./12-Merge-Mutation-TTL小Part磁盘与对象存储治理.md) | P1 | 已完成 |
| C13 | [内存、线程、网络、并发、容量规划与 Benchmark](./13-内存线程网络并发容量规划与Benchmark.md) | P1 | 已完成 |
| C14 | [备份恢复、权限、配额、升级与生产故障 Runbook](./14-备份权限配额升级与生产故障Runbook.md) | P1 | 已完成 |
| C15 | [ClickHouse Client、System 表与运维命令手册](./15-ClickHouse-Client-System表与运维命令手册.md) | P0 | 已完成 |

当前完成 **16/16**，剩余 **0 篇**。

## 3. 学习顺序

### 3.1 单节点存储 {/* #单节点存储 */}

完成 C01～C05，能够从一行数据追到不可变 Part、列文件、Mark 和 Granule；理解 `PARTITION BY` 不是普通查询主索引，`ORDER BY` 才决定物理排序和稀疏索引效果。

### 3.2 查询执行 {/* #查询执行 */}

完成 C06～C08，使用 `EXPLAIN`、`system.query_log`、读行/字节、峰值内存和 Pipeline 证明优化，而不是只比较一次 wall time。

### 3.3 分布式生产 {/* #分布式生产 */}

完成 C09～C15，分清：

```text
Shard：水平拆分数据与计算
Replica：同一 shard 的冗余副本
Distributed Table：路由与汇总逻辑层
ReplicatedMergeTree：表级复制
Keeper：协调复制元数据和一致顺序
```

## 4. P0 验收题

- 为什么大量单行 INSERT 会制造小 Part 和 Merge 压力？
- `PARTITION BY toDate(ts)` 与 `ORDER BY` 各自解决什么？
- ClickHouse 稀疏主键索引为什么不是逐行 B+Tree？
- ReplacingMergeTree 为什么不能保证查询立刻只有一行最终值？
- Replica 已存在为什么仍要备份？
- Distributed 查询慢，问题可能在本地读取、网络、远端聚合还是最终汇总？
- CPU 低但查询慢，应看磁盘、远端、线程限制、锁还是 Merge？
- Mutation 为什么可能比想象中昂贵？

## 5. 实验拓扑

```text
单节点：Part、排序、Mark、Merge、查询 Pipeline
2 shard × 2 replica + 3 Keeper：分片、复制、故障
Kafka → Materialized View → MergeTree：实时摄取
对象存储：冷热分层、缓存和恢复
Benchmark：真实 Schema/分布/并发/聚合
```

## 6. 官方资料

- [ClickHouse Documentation](https://clickhouse.com/docs)
- [ClickHouse Source](https://github.com/ClickHouse/ClickHouse)
- [ClickHouse Kubernetes Operator](https://github.com/Altinity/clickhouse-operator)

ClickHouse 路线与现有 Trino/Doris/湖仓文章保持交叉链接，但会单独补齐从部署到生产故障的完整闭环。
