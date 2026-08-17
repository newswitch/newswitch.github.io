---
title: "Node、Cluster State、Master 选举与发布机制"
sidebar_position: 6
tags: [Elasticsearch, Cluster State, Master]
description: "理解节点角色、master election、cluster state publication 和控制面稳定性。"
---

# Node、Cluster State、Master 选举与发布机制

Cluster State 包含集群 UUID、节点、索引 metadata、mapping、settings、shard routing 等控制面状态，由 elected master 协调更新并发布。

```text
request changing metadata
→ master computes new state
→ publish to master-eligible quorum
→ commit
→ apply/ack on nodes
```

它不包含全部文档数据。Mapping 爆炸、索引/Shard 过多会让 state 变大、发布慢和 master Heap 压力增加。

## 节点角色

Master-eligible 处理控制面；Data nodes 保存 Shard；Ingest 执行 Pipeline；Coordinating-only 聚合请求。小实验可混合，生产按负载分离，三个专用 master 跨故障域且资源稳定。

## 选举和多数派

系统通过投票配置和 term 防止双 master。失去多数 master-eligible 节点时，集群不能安全提交控制面变更；不要通过删除 data 目录或随意执行 unsafe bootstrap 追求快速变绿。

## 发布超时

慢节点、GC、网络、巨大 state 或磁盘可拖慢 publication/application。证据包括 master 日志、pending cluster tasks、state size、GC、网络和节点离开原因。

## 验收题

- Cluster State 包含什么、不包含什么？
- Mapping/Shard 过多为何伤害 master？
- 三个 master 节点能容忍几个故障？
- 失去多数派时为何不能强行写 metadata？

## 参考资料

- [Cluster state](https://www.elastic.co/docs/deploy-manage/distributed-architecture/cluster-state-overview)
- [Node roles](https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards/node-roles)
