---
title: "Milvus 从零到精通学习路线"
sidebar_label: "00. Milvus 从零到精通学习路线"
sidebar_position: 0
description: "以 Milvus 3.x 为主线，从 Embedding 与 ANN 深入 Collection、Segment、Index、Query、Streaming、对象存储、分布式部署、容量和故障排查。"
tags: [Milvus, 向量数据库, RAG, ANN, 学习路线]
---

# Milvus 从零到精通学习路线

Milvus 的难点不是调用 `search()`，而是理解 Embedding、距离度量、ANN 索引、Growing/Sealed Segment、加载、压缩、WAL、元数据、对象存储和 Query/Data/Streaming Node 怎样共同完成一次检索。召回率、延迟、内存和成本之间不存在免费的最优点。

本路线以 **Milvus 3.x** 架构为主线，同时标出 2.x 到 3.x 在 Coordinator、Streaming Node、WAL 和 Storage V3 等方面的差异。实验固定稳定补丁、Helm Chart 和依赖版本。

## 1. 完整写入与查询路径

```text
Embedding Model
  → Proxy
  → Streaming Node / WAL
  → Growing Segment
  → Seal / Flush
  → Object Storage
  → Data Node compaction / index build
  → Query Node load
  → ANN candidate search + scalar filter
  → merge / rerank
  → top-k result
```

元数据由 etcd 等强一致存储保存，向量/索引文件主要落对象存储，实时写入与历史查询由不同组件协作。只看一个 Pod 的 CPU 无法解释整条链路。

## 2. 篇文章规划 {/* #2-16-篇文章规划 */}

| 编号 | 文章 | 优先级 | 核心问题 | 状态 |
| --- | --- | --- | --- | --- |
| M00 | Milvus 从零到精通学习路线 | P0 | 建立向量检索和分布式组件地图 | 已完成 |
| M01 | [Embedding、距离度量、Top-K 与 ANN 基础](./01-Embedding距离度量TopK与ANN基础.md) | P0 | 余弦/IP/L2、精确与近似检索 | 已完成 |
| M02 | [Milvus Lite、Standalone、Distributed 与一次请求路径](./02-Milvus-Lite-Standalone-Distributed与一次请求路径.md) | P0 | 三种形态和组件边界 | 已完成 |
| M03 | [Collection、Schema、Primary Key、Partition 与 Dynamic Field](./03-Milvus-Collection-Schema主键分区与Dynamic-Field.md) | P0 | 数据建模、租户和过滤边界 | 已完成 |
| M04 | [Insert、Upsert、Delete、Timestamp 与一致性级别](./04-Milvus写入删除Timestamp与一致性级别.md) | P0 | 写入可见性、删除和 Session/Bounded Consistency | 已完成 |
| M05 | [Growing/Sealed Segment、Flush、Compaction 与 Garbage Collection](./05-Growing-Sealed-Segment-Flush-Compaction与GC.md) | P0 | 数据怎样从实时变成历史 | 已完成 |
| M06 | [FLAT、IVF、HNSW、DISKANN、SCANN 与索引参数](./06-FLAT-IVF-HNSW-DISKANN-SCANN与索引参数.md) | P0 | 索引选择、构建、内存和召回 | 已完成 |
| M07 | [Scalar Filter、Hybrid Search、Sparse/Dense、Rerank 与 Grouping](./07-Scalar-Filter混合检索Sparse-Dense与Rerank.md) | P0 | 多路召回和过滤执行顺序 | 已完成 |
| M08 | [Proxy、Coordinator、Streaming、Query、Data Node 源码职责](./08-Milvus组件源码职责与请求主路径.md) | P2 | 控制面、数据面和调度主路径 | 已完成 |
| M09 | [etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理](./09-etcd-Woodpecker与S3-MinIO依赖原理.md) | P0 | 元数据、日志和大对象分别保存什么 | 已完成 |
| M10 | [Lite、Compose Standalone、Helm/K8s Distributed 多种部署](./10-Milvus-Lite-Compose-Helm与Kubernetes生产部署.md) | P0 | 从本地到生产集群交付 | 已完成 |
| M11 | [Shard、Replica、Resource Group、Load/Release 与弹性扩缩](./11-Shard-Replica-Resource-Group与弹性扩缩.md) | P1 | 查询资源隔离和伸缩 | 已完成 |
| M12 | [向量维度、Segment、索引、QPS、内存与容量规划](./12-向量维度Segment索引QPS与容量规划.md) | P1 | 如何估算节点、对象存储和构建资源 | 已完成 |
| M13 | [Benchmark、Recall、P95/P99、监控与性能调优](./13-Milvus-Benchmark-Recall监控与性能调优.md) | P1 | 正确性与性能怎样一起测 | 已完成 |
| M14 | [备份、Snapshot、升级、迁移、安全与多租户](./14-Milvus备份升级迁移安全与多租户.md) | P1 | 数据恢复和变更边界 | 已完成 |
| M15 | [写入积压、加载失败、OOM、慢查询与生产故障 Runbook](./15-Milvus生产故障Runbook.md) | P1 | 从 API 到依赖逐层排查 | 已完成 |

当前完成 **16/16**，剩余 **0 篇**。

## 3. 学习阶段

### 3.1 阶段一：先学检索数学 {/* #阶段一先学检索数学 */}

完成 M01。必须用同一组向量手算余弦、内积和 L2，理解归一化怎样改变结果；再比较 Recall@K、MRR/NDCG 与 P99，避免只看 QPS。

### 3.2 阶段二：单库数据路径 {/* #阶段二单库数据路径 */}

完成 M02～M07。目标是能解释一条新写入向量何时可见、为什么索引未必立即存在、Delete 何时物理消失、Scalar Filter 在 ANN 前后对代价有什么影响。

### 3.3 阶段三：分布式架构 {/* #阶段三分布式架构 */}

完成 M08～M11：

```text
Access：Proxy
Control：Coordinator
Streaming：实时日志、Growing 数据和恢复
Historical Compute：Query Node / Data Node
Storage：metadata + WAL + object storage
```

要能区分扩 Query Node、Data Node、Streaming Node 和对象存储分别解决什么瓶颈。

### 3.4 阶段四：生产 SRE {/* #阶段四生产-sre */}

完成 M12～M15。建立向量条数×维度×类型、索引系数、副本数、加载比例、查询并发、写入速率、Compaction 和对象存储带宽模型。

## 4. P0 验收题

- Cosine、IP 与 L2 能否在未归一化向量上产生完全不同排序？
- 写入成功后为什么查询可能暂时不可见？
- Growing 与 Sealed Segment 的查询路径有什么不同？
- 建好 HNSW 后为何内存显著增加，`M` 与 `ef` 怎样影响它？
- Query Node OOM 应减少 top-k、索引加载、并发还是增加副本？如何取证？
- etcd、WAL 和对象存储任一不可用分别影响什么？
- Milvus Standalone 为什么不能简单原地在线升级成 Distributed？
- QPS 达标但 Recall 下降，为什么仍是失败的优化？

## 5. 实验环境

```text
Milvus Lite：API、Schema、Metric、索引和召回实验
Standalone：Segment、Flush、Compaction、依赖和持久化
Distributed：组件扩缩、Resource Group、故障和恢复
RAG 链路：Embedding → Milvus → Reranker → LLM
性能环境：固定数据集、ground truth、Recall + latency + resource
```

## 6. 官方资料

- [Milvus Documentation](https://milvus.io/docs)
- [Architecture Overview](https://milvus.io/docs/architecture_overview.md)
- [Deployment Options](https://milvus.io/docs/install-overview.md)
- [Milvus Source](https://github.com/milvus-io/milvus)

Milvus 官方文档说明当前存在 Lite、Standalone 和 Distributed 三种部署形态；本系列会分别讲清它们的状态边界和迁移限制，而不是只提供一份 Helm values。
