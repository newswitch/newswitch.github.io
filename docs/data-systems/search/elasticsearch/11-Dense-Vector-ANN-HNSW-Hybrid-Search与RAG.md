---
title: "Dense Vector、ANN、HNSW、Hybrid Search 与 RAG"
sidebar_label: "11. Dense Vector、ANN、HNSW、Hybrid Search 与 RAG"
sidebar_position: 11
tags: [Elasticsearch, Vector, HNSW, Hybrid Search, RAG]
description: "理解 Elasticsearch 向量索引、ANN、混合召回、重排和 RAG 质量成本。"
---

# Dense Vector、ANN、HNSW、Hybrid Search 与 RAG

写入链路：文档切分 → Embedding 模型 → dense vector + metadata → HNSW/向量索引。查询链路：同版本模型生成 query vector → ANN Top-K → 关键词/过滤混合 → rerank → LLM。

## HNSW 权衡

构图参数影响索引时间/内存/召回，查询候选参数影响 Recall 与延迟。向量存储和图结构可能显著增加内存/磁盘；量化降低成本但引入误差。参数名称随版本变化，以 mapping/API 为准。

## Hybrid

BM25 擅长精确术语，Vector 擅长语义。可分别检索再用 RRF 等融合，或在单请求组合。两路 score 尺度不同，不应直接随意相加；使用标注集评估 Recall@K/NDCG 和最终答案正确率。

## Filter

租户、ACL、时间和类型过滤必须进入检索路径。高选择性过滤会改变 ANN 候选需求；先向量检索后在应用丢弃无权结果既有泄露风险又会返回不足。

## RAG 边界

搜索相关不等于答案正确。记录 chunk/version/model/query/候选/重排和引用；无相关文档时允许拒答。更换 Embedding 需新索引回填和双读评测。

## 验收题

- HNSW 搜索参数怎样交换 Recall 与 P99？
- BM25 与向量为什么需要融合而非简单相加？
- ACL Filter 为什么不能放在应用后处理？
- 模型升级为何通常要重建向量？

## 参考资料

- [Vector search](https://www.elastic.co/docs/solutions/search/vector)
- [kNN search](https://www.elastic.co/docs/solutions/search/vector/knn)
