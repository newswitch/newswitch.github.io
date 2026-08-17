---
title: "同步复制、刷盘、SyncStateSet、选主与数据丢失边界"
sidebar_label: "11. 同步复制、刷盘、SyncStateSet、选主与数据丢失边界"
sidebar_position: 11
tags: [RocketMQ, Replication, SyncStateSet, RPO]
description: "拆解 Broker 写确认、磁盘刷盘、复制确认、Controller 选主和数据丢失窗口。"
---

# 同步复制、刷盘、SyncStateSet、选主与数据丢失边界

```text
T1 master append memory/page cache
T2 local fsync
T3 replicas receive/append
T4 replicas enter SyncStateSet/caught-up condition
T5 producer receives SEND_OK
```

实际等待点由刷盘、复制和 `inSyncReplicas/allAckInSyncStateSet` 等配置决定。SEND_OK 需按配置解释，不能默认所有副本磁盘都稳定。

## SyncStateSet

表示有资格同步/选主的副本集合。落后副本会被移出；最小同步副本可在冗余不足时拒绝写，以可用性换 RPO。允许 unclean master 可能选择旧副本并丢消息，必须业务审批。

## Controller

Controller 维护 epoch、主角色和集合，Raft 多数派防止冲突选主。Broker 切换后 Producer 从 NameServer/Proxy 更新路由。旧主恢复按 epoch/角色重新加入，不能同时对外写。

## 故障实验

持续发送连续序号并记录成功 receipt，分别故障 replica、master、Controller follower/leader、网络和磁盘慢；新主后比对所有已确认序号、重复和缺口。

## 验收题

- 本地同步刷盘与副本同步有何差异？
- SyncStateSet 缩小时为何可能拒绝写？
- Unclean election 换取了什么、牺牲什么？
- 如何证明已确认消息的 RPO？

## 参考资料

- [Controller failover](https://rocketmq.apache.org/docs/deploymentOperations/03autofailover/)
