---
title: "Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector"
sidebar_label: "04. Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector"
sidebar_position: 4
description: "理解 Redis 特殊结构与模块能力的精度、内存、索引和产品边界。"
tags: [Redis, Bitmap, HyperLogLog, JSON, Search, Vector]
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

## 1. 选择方法 {/* #选择方法 */}

Bitmap 的空间近似由最大 bit offset 决定，ID 极稀疏时会浪费内存。HyperLogLog 适合 UV 趋势和容量估计，不适合账务精确计数。Geo 应保存原始坐标和坐标系，关键地理计算需专门 GIS。

JSON/Search/Vector 依赖目标 Redis 发行形态和模块版本。写入文档后，主数据、二级索引和持久化/复制都有成本；索引字段越多、文本越长、向量维度越大，内存与重建时间越高。

## 2. Vector 评测 {/* #vector-评测 */}

```text
embedding version + dimension + metric
→ exact ground truth
→ index parameters
→ Recall@K + P99 + memory + build time
→ scalar filter and concurrent writes
```

若需要十亿级向量、独立查询资源组和对象存储分离，应与 Milvus 比较；若需要搜索集群和复杂全文相关性，应与 Elasticsearch 比较。

## 3. 排障 {/* #排障 */}

结果不准先查数据/模型/metric/过滤，再查索引；内存暴涨查最大 offset、文档字段、索引数量和向量维度；重建期间查 CPU、fork/持久化、复制与客户端 P99。

## 4. Redis 8.x 能力边界与实验矩阵 {/* #redis-8x-能力边界与实验矩阵 */}

Redis 8 已把 Search、JSON、Time Series 和概率数据结构整合进 Redis Open Source；8.8 还增加 Array 等能力。部署前仍要用 `INFO server`、`COMMAND INFO` 和发行版文档确认版本，不能假设旧 Redis 7、Redis Stack 和所有云托管产品具有相同命令。

| 目标 | 数据结构 | 必须验证 |
|---|---|---|
| 活跃标记 | Bitmap | 最大 offset 导致的内存、稀疏度 |
| 近似 UV | HyperLogLog | 误差可接受、不能反查成员 |
| 地理邻近 | GEO | 坐标精度、边界与距离单位 |
| 文档更新 | JSON | 路径、索引同步、对象大小 |
| 文本/向量检索 | Search/Vector | schema、召回、过滤、索引内存 |

用固定数据集比较精确答案与 HLL/ANN 结果，输出误差或 Recall@K；同时记录 `MEMORY USAGE`、构建时间、P99 和复制/AOF 放大。向量维度、模型版本和归一化方式必须进入 Schema 契约，模型升级应新建索引并双跑验证。

## 5. 验收题 {/* #验收题 */}

- HyperLogLog 为什么不能代替精确集合？
- 稀疏用户 ID 为什么不适合直接作 Bitmap offset？
- Redis Vector 与 Milvus 的选型维度有哪些？
- JSON 文档小但索引为何可能很大？

## 6. 参考资料 {/* #参考资料 */}

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis Query Engine](https://redis.io/docs/latest/develop/ai/search-and-query/)
