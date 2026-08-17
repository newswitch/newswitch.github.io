---
title: "Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector"
sidebar_position: 4
tags: [Redis, Bitmap, HyperLogLog, JSON, Search, Vector]
description: "理解 Redis 特殊结构与模块能力的精度、内存、索引和产品边界。"
---

# Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector

特殊结构不是“更高级的命令”，而是针对特定数据分布的空间—精度—查询能力交换。

| 能力 | 适用 | 关键边界 |
| --- | --- | --- |
| Bitmap/Bitfield | 稠密布尔状态、签到 | 最大 offset 决定 String 空间 |
| HyperLogLog | 近似去重计数 | 有误差，不能枚举成员 |
| Geo | 经纬度附近查询 | 地球模型与精度有限 |
| JSON | 局部字段访问 | 文档/索引内存与更新放大 |
| Search | 文本/标量索引 | 索引构建、Schema 与一致性 |
| Vector | 小中规模向量/混合检索 | 维度、索引内存、召回与专用库比较 |

## 选择方法

Bitmap 的空间近似由最大 bit offset 决定，ID 极稀疏时会浪费内存。HyperLogLog 适合 UV 趋势和容量估计，不适合账务精确计数。Geo 应保存原始坐标和坐标系，关键地理计算需专门 GIS。

JSON/Search/Vector 依赖目标 Redis 发行形态和模块版本。写入文档后，主数据、二级索引和持久化/复制都有成本；索引字段越多、文本越长、向量维度越大，内存与重建时间越高。

## Vector 评测

```text
embedding version + dimension + metric
→ exact ground truth
→ index parameters
→ Recall@K + P99 + memory + build time
→ scalar filter and concurrent writes
```

若需要十亿级向量、独立查询资源组和对象存储分离，应与 Milvus 比较；若需要搜索集群和复杂全文相关性，应与 Elasticsearch 比较。

## 排障

结果不准先查数据/模型/metric/过滤，再查索引；内存暴涨查最大 offset、文档字段、索引数量和向量维度；重建期间查 CPU、fork/持久化、复制与客户端 P99。

## 验收题

- HyperLogLog 为什么不能代替精确集合？
- 稀疏用户 ID 为什么不适合直接作 Bitmap offset？
- Redis Vector 与 Milvus 的选型维度有哪些？
- JSON 文档小但索引为何可能很大？

## 参考资料

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis Query Engine](https://redis.io/docs/latest/develop/ai/search-and-query/)
