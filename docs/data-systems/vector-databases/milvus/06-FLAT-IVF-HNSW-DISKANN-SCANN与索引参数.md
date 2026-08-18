---
title: "FLAT、IVF、HNSW、DISKANN、SCANN 与索引参数"
sidebar_label: "06. FLAT、IVF、HNSW、DISKANN、SCANN 与索引参数"
sidebar_position: 6
description: "按召回、延迟、内存、构建和硬件选择 Milvus 向量索引。"
tags: [Milvus, ANN, HNSW, IVF, DISKANN]
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

## 1. 评测流程 {/* #评测流程 */}

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

## 2. 参数治理 {/* #参数治理 */}

保存 index definition、build version、search params 和评测结果。查询参数可按 SLO 分级，但不能允许任意客户端无限增大候选宽度。索引变更采用新 index/Collection、双读和回滚。

## 3. 用 Recall 曲线选索引 {/* #用-recall-曲线选索引 */}

固定数据、查询集、Embedding 版本、距离度量和过滤条件，用 FLAT 结果建立 ground truth。对每种候选索引记录 build time、index bytes、load memory、Recall@10、P50/P95/P99 与峰值 QPS，再扫描 `nprobe`、`ef`、`search_list` 等查询参数。

```text
索引选择不是“谁最快”：
数据规模/增长 -> 内存和磁盘预算 -> 召回目标 -> 写入与建索引窗口 -> 延迟/QPS
```

Milvus 3.0 增加了新的索引和 FAISS passthrough 等能力；具体支持的向量类型、GPU/CPU、参数名与默认值以当前版本文档为准。索引构建成功不等于已加载可查，实验要分别记录 build、load 和 search 三个阶段。模型或归一化方式改变后必须重建索引并重新评估召回。

## 4. 验收题 {/* #验收题 */}

- FLAT 为什么可作 Ground Truth？
- nprobe 增大通常怎样影响 Recall/P99？
- HNSW 为何内存较高？
- DISKANN 对磁盘提出什么要求？

## 5. 参考资料 {/* #参考资料 */}

- [Index explained](https://milvus.io/docs/index-explained.md)
- [Index in-memory](https://milvus.io/docs/index-vector-fields.md)
