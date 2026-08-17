---
title: "ReplicatedMergeTree、Shard、Replica、Distributed Table 与路由"
sidebar_position: 10
tags: [ClickHouse, Replication, Shard, Distributed]
description: "理解本地复制表、分片、Distributed 路由、写入与查询故障语义。"
---

# ReplicatedMergeTree、Shard、Replica、Distributed Table 与路由

```text
Distributed table (routing, no primary data)
→ shard 1 local ReplicatedMergeTree: replica A/B
→ shard 2 local ReplicatedMergeTree: replica A/B
```

Shard 水平切数据，Replica 保存同一 Shard 冗余。ReplicatedMergeTree 借 Keeper 协调 Part 复制；Distributed 表根据集群配置和 sharding key 发起远程写/查。

## 写入

可直接写目标 Shard local 表，或写 Distributed。同步/异步分布式写的确认和本地 queue 语义不同；异步目录/队列满或远端失败需监控 `system.distribution_queue`。

## 查询

Initiator 把子查询发各 Shard 的一个 Replica，局部过滤/聚合后合并。`prefer_localhost_replica`、load balancing、skip unavailable shards 等影响正确性与可用；跳过不可用 Shard 会返回部分结果，必须显式业务接受。

## Sharding Key

按 tenant/user 等稳定哈希可均衡并让相关数据共置。随机写均衡但 Join/聚合可能跨网；低基数或倾斜键制造热 Shard。扩 Shard 不自动重分旧数据。

## 验收题

- Distributed 表保存完整数据吗？
- Replica 与 Shard 的扩展方向差异？
- 跳过不可用 Shard 会怎样影响结果？
- 增加 Shard 后旧数据为何不自动迁移？

## 参考资料

- [Distributed engine](https://clickhouse.com/docs/engines/table-engines/special/distributed)
- [Replication](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication)
