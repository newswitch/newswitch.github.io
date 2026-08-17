---
title: "向量维度、Segment、索引、QPS、内存与容量规划"
sidebar_label: "12. 向量维度、Segment、索引、QPS、内存与容量规划"
sidebar_position: 12
tags: [Milvus, 容量规划, Vector, Segment]
description: "估算向量原始空间、索引放大、查询加载、写入和对象存储容量。"
---

# 向量维度、Segment、索引、QPS、内存与容量规划

## 原始向量

```text
raw vector bytes ≈ rows × dimensions × bytes_per_dimension
```

再加主键、标量、binlog、索引、删除/旧版本、Replica、临时构建和对象存储冗余。压缩/量化比例必须实测。

## 查询内存

```text
loaded sealed data/index per replica
+ growing segments
+ search candidate/intermediate buffers
+ process/Go/native overhead
+ failure/rebalance headroom
```

Replica 数和 Resource Group 会复制加载数据。容量要在一个 QueryNode/故障域失效后仍满足 SLO。

## 写入

估算 row/s × payload、WAL retention、Segment seal/flush、index build backlog 和对象存储写带宽。写入突发时让队列有界并向上游背压。

## QPS

QPS 与维度、Top-K、index/search 参数、过滤、并发、fan-out 和 Recall 目标相关。用真实查询集逐步加并发，找到满足 Recall 与 P99 的可持续点。

## 节点数

分别按 Query、Data/Streaming、Index、Coordinator/Proxy 和依赖定容，取各组件瓶颈；Distributed 的价值就是独立扩缩，不能用总 CPU 平均掩盖 QueryNode 饱和。

## 验收题

- 只用 rows×dimension 为什么低估容量？
- Replica 如何影响加载内存？
- 写入容量为何包含索引构建 backlog？
- GPU 利用率低但 P99 高可能在哪些层？

## 参考资料

- [Milvus sizing tool](https://milvus.io/tools/sizing)
