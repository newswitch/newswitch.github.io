---
title: "Benchmark、Recall、P95/P99、监控与性能调优"
sidebar_label: "13. Benchmark、Recall、P95/P99、监控与性能调优"
sidebar_position: 13
description: "把检索正确性与吞吐、尾延迟、资源和冷启动统一评测。"
tags: [Milvus, Benchmark, Recall, 性能]
---

# Benchmark、Recall、P95/P99、监控与性能调优

## 1. 测试矩阵 {/* #测试矩阵 */}

```text
dataset: real distribution + labels
index: type/build parameters
query: topK/filter/search parameters
load: concurrency/QPS/read-write mix
state: warm/cold/load/rebalance/failure
result: Recall@K/NDCG + P50/P95/P99 + errors + cost
```

先用 FLAT/可靠基线建立 Ground Truth，再 sweep ANN 参数。只报告 QPS 不报告 Recall 会奖励错误结果。

## 2. 端到端分段 {/* #端到端分段 */}

记录客户端池/网络、Proxy 排队、QueryNode 搜索、Segment fan-out、Reduce、返回字段和 Rerank。SDK 总耗时与服务端 histogram 要用 trace/request ID 对齐。

## 3. 监控 {/* #监控 */}

- Proxy QPS/error/latency/queue；
- QueryNode search/segment/load/CPU/GPU/内存；
- Data/Streaming mutation lag/flush/compaction；
- Index build queue/time/failure；
- Coordinator task/metadata；
- etcd/WAL/object storage latency/error；
- Collection load/segment/row count。

## 4. 调优顺序 {/* #调优顺序 */}

先正确 Schema/过滤和索引，再调 search width/Top-K；再改善批次、并发和资源；最后才改低层参数。每次只改变一组变量并保留回滚基线。

## 5. 一份合格 Benchmark 的执行顺序 {/* #一份合格-benchmark-的执行顺序 */}

1. 固定 Milvus/SDK/Embedding 版本、硬件、数据集、索引和随机种子。
2. 用 FLAT/精确计算建立 ground truth，定义 Recall@K 与业务质量门槛。
3. 完成数据加载和预热，再测稳态与冷启动；区分客户端、排队、搜索和 rerank 延迟。
4. 扫描并发和索引查询参数，直到出现饱和点，记录 P50/P95/P99、QPS、错误、CPU、内存、IO 和对象存储。
5. 混入真实写入/删除并执行节点故障，验证 compaction、加载和恢复对前台的影响。

调优按“正确性/召回 → 资源瓶颈 → 单个参数 → 复测”进行。平均延迟会掩盖排队和长尾；只用随机向量会掩盖真实数据聚簇、过滤选择性与缓存行为。报告必须附完整参数和原始结果，确保他人能够复现。

## 6. 验收题 {/* #验收题 */}

- 为什么 Recall 必须与 P99 同时报告？
- 冷启动测试覆盖什么？
- Proxy 低 CPU 是否能排除服务端瓶颈？
- 调大候选数的三项代价是什么？

## 7. 参考资料 {/* #参考资料 */}

- [Milvus benchmark](https://milvus.io/docs/benchmark.md)
