---
title: "Node、Cluster State、Master 选举与发布机制"
sidebar_label: "06. Node、Cluster State、Master 选举与发布机制"
sidebar_position: 6
description: "理解节点角色、master election、cluster state publication 和控制面稳定性。"
tags: [Elasticsearch, Cluster State, Master]
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

## 1. 节点角色 {/* #节点角色 */}

Master-eligible 处理控制面；Data nodes 保存 Shard；Ingest 执行 Pipeline；Coordinating-only 聚合请求。小实验可混合，生产按负载分离，三个专用 master 跨故障域且资源稳定。

## 2. 选举和多数派 {/* #选举和多数派 */}

系统通过投票配置和 term 防止双 master。失去多数 master-eligible 节点时，集群不能安全提交控制面变更；不要通过删除 data 目录或随意执行 unsafe bootstrap 追求快速变绿。

## 3. 发布超时 {/* #发布超时 */}

慢节点、GC、网络、巨大 state 或磁盘可拖慢 publication/application。证据包括 master 日志、pending cluster tasks、state size、GC、网络和节点离开原因。

## 4. 实验与故障边界 {/* #实验与故障边界 */}

```http
GET _cluster/health
GET _cat/nodes?v&h=name,ip,node.role,master,heap.percent,ram.percent,cpu,load_1m
GET _cluster/state/master_node,metadata?filter_path=master_node,metadata.cluster_uuid
GET _cluster/settings?include_defaults=true&flat_settings=true
```

在测试集群停止当前 master-eligible 节点，记录选举期间写入、创建索引等 cluster-state 操作的表现；恢复后确认 cluster UUID 未变化、节点重新加入且 pending tasks 下降。不要通过删除 data path、重新设置 `cluster.initial_master_nodes` 或强制形成新集群来“修复”选举问题。

控制面异常时保存 master 日志、`_cluster/pending_tasks`、GC、网络丢包和磁盘 fsync。大量动态字段、索引和 shard 会放大 cluster state；真正治理方法是限制 mapping 爆炸与 shard 总量，而不是只扩大 master heap。

## 5. 验收题 {/* #验收题 */}

- Cluster State 包含什么、不包含什么？
- Mapping/Shard 过多为何伤害 master？
- 三个 master 节点能容忍几个故障？
- 失去多数派时为何不能强行写 metadata？

## 6. 参考资料 {/* #参考资料 */}

- [Cluster state](https://www.elastic.co/docs/deploy-manage/distributed-architecture/cluster-state-overview)
- [Node roles](https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards/node-roles)
