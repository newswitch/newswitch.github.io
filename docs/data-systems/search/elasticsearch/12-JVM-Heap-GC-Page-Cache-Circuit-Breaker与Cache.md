---
title: "JVM Heap、GC、Page Cache、Circuit Breaker 与 Cache"
sidebar_label: "12. JVM Heap、GC、Page Cache、Circuit Breaker 与 Cache"
sidebar_position: 12
tags: [Elasticsearch, JVM, GC, Page Cache, Circuit Breaker]
description: "理解 Elasticsearch 堆内、堆外、文件缓存和内存保护边界。"
---

# JVM Heap、GC、Page Cache、Circuit Breaker 与 Cache

```text
container/host memory
├─ JVM heap: objects, cluster state, queues, aggregations, caches
├─ off-heap/native: direct buffers, mmap metadata
└─ OS Page Cache: Lucene segment pages
```

Heap 不能占满主机，Lucene 搜索依赖 Page Cache。官方自动 Heap/平台建议优先，手工设置时 Xms=Xmx 并与 cgroup limit 对齐。

## GC

观察 GC pause、frequency、allocation rate、old generation，而非只看当前 heap%。持续高 old gen 可能来自大聚合、mapping/cluster state、过多 Shard、队列或缓存。Heap dump 含业务数据，采集需审批和加密。

## Circuit Breaker

Breaker 估算请求、fielddata、in-flight 等内存并提前拒绝，防止 OOM，但估算不是绝对保护。触发时应减少请求基数/并发、修正 mapping/聚合，而非只提高 limit。

## Cache

Query cache 缓存符合条件的 filter 结果，request cache 常适合重复只读聚合；Fielddata 将 text 数据加载 Heap，通常应使用 keyword/doc values。缓存命中受 segment refresh 和查询形状影响。

## 排障

```text
P99/GC → heap pool/GC log → top request/aggregation
→ shard count/cluster state → Page Cache/disk → breaker/rejection
```

重启可暂时清内存但破坏 Page Cache 并触发恢复，不是根治。

## 验收题

- Heap 设成全部内存为何更慢？
- Breaker 触发为何不应直接调大？
- Fielddata 与 Doc Values 的内存位置差异？
- 重启后为何可能出现冷缓存延迟？

## 参考资料

- [JVM settings](https://www.elastic.co/docs/reference/elasticsearch/jvm-settings/)
- [Circuit breaker settings](https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/circuit-breaker-settings)
