---
title: "Snapshot、Restore、CCR、跨集群搜索与灾备"
sidebar_label: "15. Snapshot、Restore、CCR、跨集群搜索与灾备"
sidebar_position: 15
tags: [Elasticsearch, Snapshot, CCR, Disaster Recovery]
description: "理解副本与备份差异、增量快照、CCR、CCS 和灾备切换。"
---

# Snapshot、Restore、CCR、跨集群搜索与灾备

Replica 与主分片共享错误域和逻辑删除，不是备份。Snapshot 将 segment 增量保存到独立 Repository，可恢复索引和部分集群状态。

## Snapshot

Repository 可是 S3/对象存储/共享文件等受支持后端。多个集群写同一 Repository 需按文档控制，不能手工修改其文件。监控 SLM、失败、时长、存储和保留。

恢复先到隔离集群，处理同名索引、模板、Feature State、版本兼容和安全配置，再验证文档数、业务查询和权限。

## CCR

Cross-Cluster Replication 让 follower index 拉取 leader 操作，适合异地只读和 DR。它传播逻辑删除/错误，不替代 Snapshot；网络中断会积压 retention lease/WAL 类历史并影响恢复。

## CCS

Cross-Cluster Search 在查询时跨集群 fan-out，延迟和可用性受远端影响。设置 skip_unavailable 要与业务“部分结果是否可接受”一致。

## DR 切换

```text
freeze/fence source writes
→ confirm follower lag/restore point
→ promote/unfollow or restore
→ switch aliases/DNS/clients
→ validate writes and queries
→ plan reverse replication before failback
```

RPO/RTO 用故障演练证明，不用“有 CCR”推断。

## 验收题

- Replica 为什么不是备份？
- Snapshot 增量复用了什么？
- CCR 为什么会复制误删除？
- Failback 为什么比 DNS 切回复杂？

## 参考资料

- [Snapshot and restore](https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore)
- [Cross-cluster replication](https://www.elastic.co/docs/deploy-manage/tools/cross-cluster-replication)
