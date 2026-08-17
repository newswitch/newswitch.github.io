---
title: "Benchmark、Recall、P95/P99、监控与性能调优"
sidebar_label: "13. Benchmark、Recall、P95/P99、监控与性能调优"
sidebar_position: 13
tags: [Milvus, Benchmark, Recall, 性能]
description: "把检索正确性与吞吐、尾延迟、资源和冷启动统一评测。"
---

# Benchmark、Recall、P95/P99、监控与性能调优

## 测试矩阵

```text
dataset: real distribution + labels
index: type/build parameters
query: topK/filter/search parameters
load: concurrency/QPS/read-write mix
state: warm/cold/load/rebalance/failure
result: Recall@K/NDCG + P50/P95/P99 + errors + cost
```

先用 FLAT/可靠基线建立 Ground Truth，再 sweep ANN 参数。只报告 QPS 不报告 Recall 会奖励错误结果。

## 端到端分段

记录客户端池/网络、Proxy 排队、QueryNode 搜索、Segment fan-out、Reduce、返回字段和 Rerank。SDK 总耗时与服务端 histogram 要用 trace/request ID 对齐。

## 监控

- Proxy QPS/error/latency/queue；
- QueryNode search/segment/load/CPU/GPU/内存；
- Data/Streaming mutation lag/flush/compaction；
- Index build queue/time/failure；
- Coordinator task/metadata；
- etcd/WAL/object storage latency/error；
- Collection load/segment/row count。

## 调优顺序

先正确 Schema/过滤和索引，再调 search width/Top-K；再改善批次、并发和资源；最后才改低层参数。每次只改变一组变量并保留回滚基线。

## 验收题

- 为什么 Recall 必须与 P99 同时报告？
- 冷启动测试覆盖什么？
- Proxy 低 CPU 是否能排除服务端瓶颈？
- 调大候选数的三项代价是什么？

## 参考资料

- [Milvus benchmark](https://milvus.io/docs/benchmark.md)
