---
title: "Primary/Replica Shard、路由、分配、恢复与 Rebalance"
sidebar_label: "07. Primary/Replica Shard、路由、分配、恢复与 Rebalance"
sidebar_position: 7
description: "理解文档路由、主副分片、allocation decider、恢复和再均衡。"
tags: [Elasticsearch, Shard, Replica, Allocation]
---

# Primary/Replica Shard、路由、分配、恢复与 Rebalance

文档默认按 routing/id 哈希到固定 primary shard。写经主分片后复制到 in-sync replicas；搜索对目标 Shard 的某个副本 fan-out。

## 1. 状态 {/* #状态 */}

```text
UNASSIGNED → INITIALIZING → STARTED → RELOCATING
```

Primary 未分配导致 red，Replica 未分配导致 yellow。使用 `_cluster/allocation/explain` 获取 decider 证据：磁盘水位、过滤、tier、awareness、版本、同节点副本等。

## 2. 故障恢复 {/* #故障恢复 */}

节点离开后 master 决定提升 in-sync replica，并分配缺失副本。恢复可从 peer 或 Snapshot 复制 segment，同时传输增量操作。Recovery 抢占磁盘/网络，限速过低延长风险窗口，过高伤害业务。

## 3. Awareness {/* #awareness */}

设置 zone/rack awareness 并保证每个 Shard 的副本跨故障域。Forced awareness 可避免单区故障时把所有副本塞进剩余区，但会保持 yellow；这是容量/风险决策。

## 4. Rebalance {/* #rebalance */}

扩容后 Shard 不会瞬间均衡，Relocation 产生额外 I/O。观察节点磁盘、shard count/size、recovery queue 和业务 P99。不要用排空多节点同时迁移。

## 5. 危险操作 {/* #危险操作 */}

Allocate stale primary/accept data loss 会放弃更新，只在备份和业务确认后使用。先保存 allocation explain、节点日志、Snapshot 状态和 shard store 证据。

## 6. 可执行诊断：先解释未分配，再决定动作 {/* #可执行诊断先解释未分配再决定动作 */}

```http
GET _cluster/health?level=shards
GET _cat/shards?v&s=state,index,shard
POST _cluster/allocation/explain
{"index":"<index>","shard":0,"primary":false}
GET _cat/recovery?v&active_only=true
```

`allocation_explain` 的 decider 是处理入口：磁盘水位、节点属性、tier、版本、同节点副本约束和 allocation filter 对应不同修复。先恢复容量/节点/约束，再观察自动收敛；不要首先使用 `allocate_stale_primary`，因为接受数据丢失会让旧副本内容被覆盖。

演练至少覆盖单 data 节点下线和单可用区不可达，记录恢复流量对前台 P99 的影响。故障域感知只有在副本数、节点分布和强制 awareness 同时正确时才成立；副本和主分片不能位于同一节点。

## 7. 验收题 {/* #验收题 */}

- Yellow 与 Red 的数据可用性差异是什么？
- In-sync replica 为什么影响安全提升？
- Awareness 与副本数如何配合？
- 扩容后 Relocation 为什么可能拖慢查询？

## 8. 参考资料 {/* #参考资料 */}

- [Shard allocation](https://www.elastic.co/docs/deploy-manage/distributed-architecture/shard-allocation-relocation-recovery)
- [Allocation explain API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cluster-allocation-explain)
