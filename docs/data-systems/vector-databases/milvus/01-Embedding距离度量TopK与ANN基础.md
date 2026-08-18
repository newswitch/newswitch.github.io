---
title: "Embedding、距离度量、Top-K 与 ANN 基础"
sidebar_label: "01. Embedding、距离度量、Top-K 与 ANN 基础"
sidebar_position: 1
description: "在进入 Milvus 组件之前，建立向量生成、归一化、距离度量、Top-K、精确检索与近似最近邻的正确模型。"
tags: [Milvus, Embedding, Vector, ANN, Top-K]
---

# Embedding、距离度量、Top-K 与 ANN 基础

Milvus 不负责把原始文本、图片或音频“理解成向量”；Embedding 通常由上游模型生成，Milvus 负责保存向量、标量元数据和索引，并在查询向量到来时寻找最相近的候选。要排查召回质量，必须把模型、数据、距离度量、索引和过滤分别看待。

## 1. 从原始对象到答案

一个 RAG 检索链路通常是：

```text
离线/写入：
Document → clean → chunk → embedding model → vector
         → metadata / ACL / version → Milvus insert → index

在线/查询：
Question → same embedding model → query vector
         → scalar filter + ANN Top-K
         → optional reranker
         → context assembly → LLM
```

Milvus 返回的是候选实体及距离/相似度，不保证候选在业务上相关，更不保证 LLM 最终答案正确。Chunk 切分、Embedding 模型、元数据过滤和 Reranker 往往比单纯调整索引参数更影响端到端效果。

## 2. Embedding 的四个契约

每个 Collection 至少应记录：

1. **模型身份**：模型名、版本、权重摘要和推理配置；
2. **向量维度**：写入和查询必须一致；
3. **预处理**：模板、语言、截断、归一化和 chunk 策略；
4. **距离语义**：COSINE、IP 或 L2，以及是否先做 L2 normalization。

更换模型后，新旧向量通常不在同一个几何空间，不能只把新查询向量拿去搜索旧库。安全迁移方式是建立新版本 Collection/字段，双写、离线回填、离线评测，再切换 Alias 或路由。

## 3. 三种常见距离

设向量为 `x`、`y`：

```text
L2 distance       = ||x - y||₂           越小越近
Inner Product     = x · y                 越大越相似
Cosine similarity = (x · y)/(|x||y|)     越大越相似
```

若两个向量都做单位归一化，IP、Cosine 与 L2 的排序存在可转换关系；若不归一化，向量模长会影响 IP，而 Cosine 主要比较方向。不能只看数值大小而忽略 metric 类型，也不要跨不同模型比较 score。

选择距离应先遵守 Embedding 模型的训练说明，再用真实标注集验证。线上阈值也必须基于该模型、该 metric 和该数据分布校准。

## 4. Top-K 到底返回什么

Top-K 的含义是，在当前检索条件、当前索引和当前一致性可见范围内，返回排名最靠前的 K 个候选。

它不等于：

- 全库中数学上绝对最近的 K 个结果；
- K 个都超过业务相关性阈值；
- 不同分区、过滤条件或索引参数下结果完全一致；
- 最终应交给 LLM 的 K 段上下文。

工程上常采用：ANN 先召回较大的 K，再由交叉编码器或业务规则重排到较小的 K。这样把“高速粗召回”和“昂贵精排”分开。

## 5. 精确检索与 ANN

若有 N 个、每个 D 维向量，暴力精确检索需要对大量向量计算距离，成本近似随 `N × D` 墠长。ANN（Approximate Nearest Neighbor）通过索引减少候选计算，以一定召回损失换取吞吐、延迟和成本。

质量不能只用 QPS 表示。最基本的离线指标是：

```text
Recall@K = ANN Top-K 与精确 Top-K 的交集数量 / K
```

生产选型应同时观察：

- Recall@K / NDCG / 业务点击或答案正确率；
- P50、P95、P99 与超时率；
- build time、index size、加载内存；
- 写入到可检索的延迟；
- 标量过滤选择性和并发；
- 节点故障、扩缩容和索引重建期间表现。

## 6. 常见 ANN 思路

### 6.1 IVF {/* #ivf */}

训练若干聚类中心，将向量分配到倒排桶。查询时只探测部分桶。

```text
更多聚类桶 / 更合理训练集 → 候选更聚焦
更大 nprobe                 → 召回提高，计算和延迟增加
```

### 6.2 HNSW {/* #hnsw */}

构建多层近邻图，查询从稀疏高层逐步走向稠密底层。

```text
更大构图参数 → 索引更大、构建更慢、潜在召回更高
更大搜索宽度 → 召回更高、查询更慢
```

### 6.3 Quantization {/* #quantization */}

用更紧凑表示减少内存和距离计算成本，但引入量化误差。是否可接受必须通过真实数据评测，不能仅凭索引名字判断。

索引参数的具体名称与可用组合随 Milvus 版本和 CPU/GPU 后端变化，文章后续会在固定版本实验中逐项验证。

## 7. 标量过滤为什么改变性能

向量检索常带有租户、时间、文档类型和 ACL 过滤：

```text
tenant_id == 42 and status == "published"
```

过滤可能在候选生成前减少搜索空间，也可能与索引/执行策略组合产生额外代价。极低命中率时，为得到 K 个结果可能需要探测更多候选；过滤字段设计和分区策略不当，还会造成分片 fan-out 或热点。

尤其不能先向量检索后在应用层丢掉无权访问的结果，因为这既可能泄露元数据，也可能导致实际返回数量不足。ACL 必须进入经过验证的检索过滤路径。

## 8. 建立黄金评测集

最小评测流程：

1. 从真实业务抽取不同语言、长度、主题和难例；
2. 为每个查询标注相关文档，保留无答案样本；
3. 保存 chunk、模型、维度、metric 与预处理版本；
4. 用暴力搜索或可靠基线生成 ground truth；
5. 对比不同索引和搜索参数的 Recall@K 与时延；
6. 加入标量过滤、并发、冷启动和增量写入；
7. 再测 Reranker 与最终答案质量。

没有固定数据集和 Ground Truth，调整索引参数只是在不同噪声间切换。

## 9. 故障定位地图

| 现象 | 先检查 |
| --- | --- |
| 完全搜不到 | collection/partition、加载状态、维度、metric、过滤、可见性 |
| 结果不相关 | chunk、模型、查询模板、归一化、metric、评测集 |
| Recall 下降 | 索引/搜索参数、数据分布变化、过滤选择性、模型版本 |
| P99 高 | fan-out、搜索宽度、并发队列、冷数据加载、网络、CPU/GPU |
| 内存暴涨 | 向量数量/维度、索引类型、replica、加载范围、segment |
| 新数据不可见 | 写入确认、flush/segment/index/load 与一致性级别 |

## 10. 验收问题

- 为什么更换 Embedding 模型通常需要重建向量？
- Cosine 和 IP 在什么前提下可能得到相同排序？
- ANN 的“近似”应使用什么基线量化？
- Top-K 结果为什么不等于 K 个正确答案？
- 增大搜索宽度会怎样同时影响召回、延迟和容量？
- 标量 ACL 为什么不能简单放到向量搜索之后处理？

## 11. 参考资料

- [Milvus 基础搜索](https://milvus.io/docs/single-vector-search.md)
- [Milvus Index Explained](https://milvus.io/docs/index-explained.md)
- [Milvus Metrics](https://milvus.io/docs/metric.md)
- [ANN Benchmarks](https://ann-benchmarks.com/)
