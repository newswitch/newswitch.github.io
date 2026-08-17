---
title: "FLAT、IVF、HNSW、DISKANN、SCANN 与索引参数"
sidebar_position: 6
tags: [Milvus, ANN, HNSW, IVF, DISKANN]
description: "按召回、延迟、内存、构建和硬件选择 Milvus 向量索引。"
---

# FLAT、IVF、HNSW、DISKANN、SCANN 与索引参数

索引可用性随 Milvus 版本、向量类型和 CPU/GPU 后端变化，先查询目标版本支持矩阵。

| 家族 | 思路 | 主要权衡 |
| --- | --- | --- |
| FLAT | 全量精确距离 | 高 Recall、成本随 N×D |
| IVF | 聚类桶，只探测部分 | nlist/nprobe 交换召回与延迟 |
| HNSW | 多层近邻图 | 高内存/构建，低延迟高召回 |
| DISKANN | 磁盘图/缓存 | 降内存，依赖 SSD 与缓存 |
| SCANN/量化 | 候选+压缩/重排 | 内存与误差交换 |

## 评测流程

```text
real vectors + labeled queries
→ FLAT ground truth
→ build each candidate index
→ sweep search params
→ Recall@K vs P95/P99/QPS
→ index size/build time/load time
→ filter/concurrency/failure
```

只测随机向量会掩盖真实聚类和过滤。索引构建也占 CPU/GPU、内存、对象存储与任务队列，增量写入期间需测构建延迟。

## 参数治理

保存 index definition、build version、search params 和评测结果。查询参数可按 SLO 分级，但不能允许任意客户端无限增大候选宽度。索引变更采用新 index/Collection、双读和回滚。

## 验收题

- FLAT 为什么可作 Ground Truth？
- nprobe 增大通常怎样影响 Recall/P99？
- HNSW 为何内存较高？
- DISKANN 对磁盘提出什么要求？

## 参考资料

- [Index explained](https://milvus.io/docs/index-explained.md)
- [Index in-memory](https://milvus.io/docs/index-vector-fields.md)
