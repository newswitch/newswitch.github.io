---
title: "Scalar Filter、Hybrid Search、Sparse/Dense、Rerank 与 Grouping"
sidebar_label: "07. Scalar Filter、Hybrid Search、Sparse/Dense、Rerank 与 Grouping"
sidebar_position: 7
description: "设计标量过滤、稀疏/稠密多路召回、重排和按文档分组。"
tags: [Milvus, Hybrid Search, Rerank, Scalar Filter]
---

# Scalar Filter、Hybrid Search、Sparse/Dense、Rerank 与 Grouping

## 1. 完整检索 {/* #完整检索 */}

```text
query
├─ dense embedding → semantic ANN
├─ sparse embedding → lexical sparse search
└─ scalar filter → tenant/time/type/ACL
→ merge/rerank → group by document → Top-K
```

标量表达式的执行时机由索引/优化决定。过滤选择性极高时，ANN 可能需要探测更多候选才能返回 K 个；应在真实 ACL/租户分布下测 Recall 和 P99。

## 2. Hybrid 与 Rerank {/* #hybrid-与-rerank */}

Dense、Sparse 的 score 尺度不同，可用 Weighted Ranker（需归一化/校准）或 RRF 等仅按排名融合。Cross-encoder 重排更精确但计算昂贵，通常对较小候选集合执行。

## 3. Grouping {/* #grouping */}

一个文档切成多个 chunk 时，Top-K 可能都来自同一文档。Grouping 按 document ID 限制/聚合，提高来源多样性，但可能增加候选需求。

## 4. 安全 {/* #安全 */}

ACL/tenant filter 必须由服务端受信代码注入，不能相信用户传入；返回字段最小化。查询日志脱敏向量、文本和租户信息。

## 5. 评测 {/* #评测 */}

分别报告 dense、sparse、hybrid、rerank 的 Recall/NDCG、最终答案、P99 和成本，避免只展示最终最好结果无法定位退化。

## 6. 端到端混合检索实验 {/* #端到端混合检索实验 */}

建立 50～100 条人工标注问题，分别运行 dense、sparse/BM25、带 scalar filter、融合和 rerank，记录 Recall@K、MRR/NDCG、P95 与空结果比例。过滤条件必须覆盖租户、时间和权限，并执行“租户 A token 查询租户 B 文档”的拒绝测试。

```text
请求 -> filter 裁剪候选 -> dense/sparse 召回 -> 分数归一/融合 -> rerank -> 去重/引用
```

不同检索器分数不能直接相加，先选择 RRF 或经过校准的加权策略。Milvus 3.0 的文本、Sparse、函数链和服务端 rerank 能力与 2.x 不同，需固定服务器/SDK 版本。RAG 最终还要评估答案忠实度和引用正确性；向量库命中率不能替代端到端质量。

## 7. 验收题 {/* #验收题 */}

- Dense 与 Sparse score 为什么不能直接相加？
- 高选择性过滤如何影响 ANN？
- Grouping 解决什么 RAG 问题？
- Reranker 为什么不直接对全库运行？

## 8. 参考资料 {/* #参考资料 */}

- [Hybrid search](https://milvus.io/docs/multi-vector-search.md)
- [Reranking](https://milvus.io/docs/reranking.md)
