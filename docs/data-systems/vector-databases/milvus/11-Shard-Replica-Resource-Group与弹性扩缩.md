---
title: "Shard、Replica、Resource Group、Load/Release 与弹性扩缩"
sidebar_position: 11
tags: [Milvus, Shard, Replica, Resource Group, Scaling]
description: "理解写入 Shard、查询 Replica、Resource Group 和 Collection 加载调度。"
---

# Shard、Replica、Resource Group、Load/Release 与弹性扩缩

Shard 常对应写入 channel/并行单元；Query Replica 是已加载数据的查询副本；Resource Group 把 QueryNode 分组并承载 Replica，提供资源隔离。

```text
Collection
→ shards/channels for ingestion
→ sealed segments
→ load into Replica(s)
→ each Replica placed on Resource Group QueryNodes
```

## Load/Release

Load 将 Collection/Partition 的 Segment 和索引调度到 QueryNode，受对象存储带宽、节点内存和任务队列影响。Release 释放查询资源但不删除持久数据。冷启动 SLO 应包含下载、校验和内存映射/加载。

## 扩容

增加 QueryNode 后要观察 Segment balance 和 Replica placement；增加 Replica 提高读吞吐/可用性，也成倍增加加载内存。写入扩展涉及 Shard/Streaming/Data 组件，不能只扩 QueryNode。

## Resource Group

可按租户、在线/离线、GPU/CPU 划分。为每组设置节点上下限和转移策略，避免一个租户大查询驱逐另一个。隔离仍需在 Proxy/认证层强制租户权限。

## 验收题

- Shard 与 Query Replica 有何区别？
- Release 是否删除对象存储数据？
- 增加 Replica 为什么增加内存？
- 扩 QueryNode 后为什么要等 rebalance/load？

## 参考资料

- [Resource groups](https://milvus.io/docs/resource_group.md)
- [Load and release](https://milvus.io/docs/load-and-release.md)
