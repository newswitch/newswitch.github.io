---
title: ClickHouse MergeTree、分区、排序键与后台合并
sidebar_label: "02. ClickHouse MergeTree、分区、排序键与后台合并"
sidebar_position: 2
tags: [ClickHouse, MergeTree, 排序键, 列式存储]
description: 理解 MergeTree 的 Part、稀疏主索引、排序键、分区、后台合并和复制数据路径。
---

# ClickHouse MergeTree、分区、排序键与后台合并

ClickHouse 面向分析查询，MergeTree 家族把批量写入形成不可变 data parts，并在后台合并。查询性能主要来自列式读取、排序组织、稀疏索引和跳过无关 granule，而不是传统 OLTP B-Tree 点更新模型。

## 1. 写入与 Part

Insert batch 被列式编码、按 `ORDER BY` 排序，生成一个新 part。大量小 insert 会产生大量 parts，后台 merge来不及会增加 metadata、查询和写入压力。因此客户端应批量写，控制 partition/写入并发。

## 2. Partition Key 与 Sorting Key

- `PARTITION BY`主要用于数据管理、分区裁剪和 TTL/删除，通常不应高基数；
- `ORDER BY`决定 part 内物理排序和稀疏主索引，直接影响常见 filter 的数据跳过；
- `PRIMARY KEY`可与排序键相关但语义不等同唯一约束，具体引擎定义需核对。

按 user_id 分成亿级 partition 是灾难；常见是按月/天分区，再按高频过滤前缀组织排序键。

## 3. 稀疏索引与 Granule

MergeTree 每隔一定 granularity记录排序键标记，查询用范围定位可能相关 granules，再读取所需列。它不会为每行维护索引，因此存储和扫描效率高，但非排序前缀过滤可能扫描很多数据。

Data skipping index、minmax、Bloom 等可帮助特定谓词，但有写入/存储成本，必须以 skipped granules/bytes验证。

## 4. Merge 与 Mutation

后台 merge将多个 parts 合并、应用特定引擎规则和 TTL。它消耗磁盘读写、CPU 与临时空间。UPDATE/DELETE mutation 往往重写相关 parts，不适合高频单行事务更新；轻量删除等能力和限制随版本确认。

磁盘接近满时 merge 无法生成新 part，会形成恶性循环。规划空间需覆盖新旧 parts并存。

## 5. Replication 与 Distributed

ReplicatedMergeTree 管理分片内副本一致与复制；Distributed 表路由查询/写入到 shards。复制不等于分片，分片不自动有副本。ZooKeeper/ClickHouse Keeper 等协调元数据是控制面，需独立监控与灾备。

Distributed 查询会在 shards 执行并合并，Join/聚合可能产生跨节点网络与内存；数据倾斜和 shard key 决定扩展效果。

## 6. 查询调优

检查 `EXPLAIN`、system tables/query log、read_rows/read_bytes、selected parts/granules、memory、ProfileEvents。先减少扫描和正确选择排序键，再考虑跳数索引、物化视图和参数。

## 7. 故障

- Too many parts：小批写/partition过细/merge落后；
- Replica lag：网络、磁盘、协调服务或 merge压力；
- 磁盘满：parts/TTL/mutation/备份与临时合并；
- 查询 OOM：高基数聚合/Join、并发、倾斜；
- 单 shard 热：sharding key 分布或热点租户。

## 8. 实验

同一数据分别用适合/不适合的 ORDER BY，执行常见 filter，比较 read rows/bytes。逐条小 insert与批量 insert对比 parts/merge。创建 TTL/物化视图前后记录资源，所有结果核对聚合。

## 9. 掌握验收

- 区分 partition、part、granule、sorting key；
- 解释稀疏索引为何不是唯一约束；
- 说明小 insert 如何形成 parts/merge压力；
- 区分 shard 与 replica；
- 从 query log 证明扫描裁剪效果。

上一篇：[Trino 架构](./01-Trino架构Stage-Split与谓词下推.md)　下一篇：[Doris MPP、Tablet 与物化视图](./03-Doris-MPP-Tablet物化视图与查询加速.md)

## 参考资料

- [ClickHouse MergeTree](https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree)
- [ClickHouse Architecture](https://clickhouse.com/docs/development/architecture)
