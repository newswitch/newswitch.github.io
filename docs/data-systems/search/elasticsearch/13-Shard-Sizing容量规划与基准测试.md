---
title: "Shard Sizing、吞吐、延迟、容量规划与基准测试"
sidebar_label: "13. Shard Sizing、吞吐、延迟、容量规划与基准测试"
sidebar_position: 13
tags: [Elasticsearch, Shard Sizing, 容量规划, Benchmark]
description: "从真实数据压缩比、Shard 大小、并发和恢复窗口估算 Elasticsearch 集群。"
---

# Shard Sizing、吞吐、延迟、容量规划与基准测试

Shard 是扩展、恢复和并行单元。过小增加 cluster state、文件和 fan-out；过大延长恢复、merge 和迁移。不存在通用固定 GB 数，需以工作负载验证。

## 磁盘

```text
daily raw × measured index/raw ratio × retention
× (1 + replica count)
+ merge temporary + watermark + recovery headroom
```

按 tier 分开计算。磁盘水位前要保留迁移空间，不能把可用容量算到 100%。

## 节点/Shard

同时满足：总磁盘、Heap/Shard overhead、索引吞吐、搜索 CPU、Page Cache 和“一个节点故障后剩余节点可承载并在 RTO 内恢复”。副本分布受 zone 和节点数约束。

## 基准

用 Rally 或自建回放固定版本、mapping、数据和查询集：

```text
bulk size/concurrency
search mix + result size + aggregations
refresh/merge/ILM
cold/warm cache
node failure/recovery
P50/P95/P99 + errors + resource
```

单线程最佳延迟和极限 QPS 都不足以定容，寻找满足 SLO 的可持续点和安全余量。

## Shard 调整

Rollover 控制未来 Shard；Shrink/Split/Reindex 有前提和 I/O 成本。修改 primary shard 数通常需新索引或特定操作，不能简单改 setting。

## 验收题

- 小 Shard 如何放大搜索？
- 容量为何要包含节点故障后的恢复？
- 原始日志大小为何不能直接当索引大小？
- Benchmark 为什么必须包含 Merge/Recovery？

## 参考资料

- [Size your shards](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards)
- [Elasticsearch Rally](https://esrally.readthedocs.io/)
