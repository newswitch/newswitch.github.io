---
title: "向量维度、Segment、索引、QPS、内存与容量规划"
sidebar_label: "12. 向量维度、Segment、索引、QPS、内存与容量规划"
sidebar_position: 12
description: "估算向量原始空间、索引放大、查询加载、写入和对象存储容量。"
tags: [Milvus, 容量规划, Vector, Segment]
---

# 向量维度、Segment、索引、QPS、内存与容量规划

## 1. 原始向量 {/* #原始向量 */}

```text
raw vector bytes ≈ rows × dimensions × bytes_per_dimension
```

再加主键、标量、binlog、索引、删除/旧版本、Replica、临时构建和对象存储冗余。压缩/量化比例必须实测。

## 2. 查询内存 {/* #查询内存 */}

```text
loaded sealed data/index per replica
+ growing segments
+ search candidate/intermediate buffers
+ process/Go/native overhead
+ failure/rebalance headroom
```

Replica 数和 Resource Group 会复制加载数据。容量要在一个 QueryNode/故障域失效后仍满足 SLO。

## 3. 写入 {/* #写入 */}

估算 row/s × payload、WAL retention、Segment seal/flush、index build backlog 和对象存储写带宽。写入突发时让队列有界并向上游背压。

## 4. QPS {/* #qps */}

QPS 与维度、Top-K、index/search 参数、过滤、并发、fan-out 和 Recall 目标相关。用真实查询集逐步加并发，找到满足 Recall 与 P99 的可持续点。

## 5. 节点数 {/* #节点数 */}

分别按 Query、Data/Streaming、Index、Coordinator/Proxy 和依赖定容，取各组件瓶颈；Distributed 的价值就是独立扩缩，不能用总 CPU 平均掩盖 QueryNode 饱和。

## 6. 可审计的容量表 {/* #可审计的容量表 */}

```text
原始向量字节 ≈ 行数 × 维度 × 每维字节
总存储 ≈ 原始字段 + 标量字段 + 索引 + delta/manifest + 副本 + 备份
查询内存 ≈ 已加载字段/索引 × replica + 运行时工作集
所需节点 ≈ max(内存约束、目标QPS约束、加载/恢复时间约束)
```

索引膨胀、压缩、segment 元数据和副本系数必须通过真实样本测量，不能只算向量数组。Milvus 3.0 Storage V3/外部 Collection 的存储和查询路径与传统全量导入不同，应分别建模对象存储容量、GET 吞吐、缓存和恢复时间。

压测使用生产维度、filter 选择性、topK、并发、写入混合和目标 Recall，输出吞吐-延迟-召回曲线。至少保留单节点故障、索引重建和高峰增长余量，并给出达到何种水位时扩容，而不是只给最终节点数。

## 7. 验收题 {/* #验收题 */}

- 只用 rows×dimension 为什么低估容量？
- Replica 如何影响加载内存？
- 写入容量为何包含索引构建 backlog？
- GPU 利用率低但 P99 高可能在哪些层？

## 8. 参考资料 {/* #参考资料 */}

- [Milvus sizing tool](https://milvus.io/tools/sizing)
