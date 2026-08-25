---
title: "Zab、Leader Election、Proposal、Commit 与数据同步"
sidebar_label: "04. ZAB、选主与多数派提交"
sidebar_position: 4
description: "沿一次写请求分析 ZooKeeper 原子广播、Leader 选举、多数派提交和 Follower 数据同步。"
tags: [ZooKeeper, Zab, Leader Election, Proposal, Commit]
---

# Zab、Leader Election、Proposal、Commit 与数据同步

ZooKeeper Atomic Broadcast（ZAB）负责把写事务按统一顺序复制到 Ensemble。它与通用 Raft 目标相近，但协议术语和恢复过程不同，不应把两者的参数和日志格式混用。

## 1. 写请求路径

```text
Client → 任意Server
→ 转发Leader
→ Leader分配zxid并生成Proposal
→ Follower持久化事务日志并ACK
→ Leader收到多数派ACK
→ COMMIT并应用到内存树
→ 响应Client
```

读通常由连接到的 Server 本地处理，因此吞吐易扩展，但读到的时点可能落后于刚在其他连接完成的写。写路径受 Leader、磁盘和多数派 RTT 限制。

## 2. zxid 与 Epoch

zxid 标识事务全序，通常可理解为高位 Epoch、低位该 Epoch 内计数。新 Leader 必须建立新的领导周期，并确保已提交历史不会被更旧数据覆盖。

选主不是选择“响应最快”的节点，而是选择拥有合适选票和足够新事务历史的节点。失去多数派时不能安全产生新提交。

## 3. 新 Leader 的同步阶段

新 Leader 与 Follower 比较历史，可能执行：

- DIFF：补发少量缺失事务；
- TRUNC：截断未提交或分叉尾部；
- SNAP：发送完整 Snapshot 后继续事务。

完成同步并获得足够参与者确认后才进入广播阶段。大 Snapshot、慢磁盘或落后节点会拉长恢复时间。

## 4. 故障边界

| 故障 | 行为 |
| --- | --- |
| 单 Follower 退出 | 多数派仍在，写继续 |
| Leader 退出 | 暂停写并重新选举 |
| 失去多数派 | 安全写停止 |
| 客户端写后连接断开 | 结果可能未知，重试需版本/CAS或幂等 |
| 慢 Follower | 可能落后或被移出同步参与集合 |

## 5. 性能含义

写 P99 至少包含客户端到 Server、转发、Leader 日志落盘、多数派网络与磁盘以及提交响应。把节点跨高延迟地域会直接拉长写路径。`dataLogDir` 使用独立低延迟磁盘，通常比单纯增加 CPU 更重要。

## 6. 实验

三节点持续写入递增值，依次停止 Follower、Leader 和两个节点；记录请求错误、选主时间、zxid 和恢复方式。恢复旧 Leader 后确认它以 Follower 身份同步，而不是带着旧领导状态继续服务。

参考：[ZooKeeper Internals](https://zookeeper.apache.org/doc/current/zookeeperInternals.html)。
