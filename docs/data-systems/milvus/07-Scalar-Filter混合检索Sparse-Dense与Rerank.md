---
title: "Scalar Filter、Hybrid Search、Sparse/Dense、Rerank 与 Grouping"
sidebar_position: 7
tags: [Milvus, Hybrid Search, Rerank, Scalar Filter]
description: "设计标量过滤、稀疏/稠密多路召回、重排和按文档分组。"
---

# Scalar Filter、Hybrid Search、Sparse/Dense、Rerank 与 Grouping

## 完整检索

```text
query
├─ dense embedding → semantic ANN
├─ sparse embedding → lexical sparse search
└─ scalar filter → tenant/time/type/ACL
→ merge/rerank → group by document → Top-K
```

标量表达式的执行时机由索引/优化决定。过滤选择性极高时，ANN 可能需要探测更多候选才能返回 K 个；应在真实 ACL/租户分布下测 Recall 和 P99。

## Hybrid 与 Rerank

Dense、Sparse 的 score 尺度不同，可用 Weighted Ranker（需归一化/校准）或 RRF 等仅按排名融合。Cross-encoder 重排更精确但计算昂贵，通常对较小候选集合执行。

## Grouping

一个文档切成多个 chunk 时，Top-K 可能都来自同一文档。Grouping 按 document ID 限制/聚合，提高来源多样性，但可能增加候选需求。

## 安全

ACL/tenant filter 必须由服务端受信代码注入，不能相信用户传入；返回字段最小化。查询日志脱敏向量、文本和租户信息。

## 评测

分别报告 dense、sparse、hybrid、rerank 的 Recall/NDCG、最终答案、P99 和成本，避免只展示最终最好结果无法定位退化。

## 验收题

- Dense 与 Sparse score 为什么不能直接相加？
- 高选择性过滤如何影响 ANN？
- Grouping 解决什么 RAG 问题？
- Reranker 为什么不直接对全库运行？

## 参考资料

- [Hybrid search](https://milvus.io/docs/multi-vector-search.md)
- [Reranking](https://milvus.io/docs/reranking.md)
