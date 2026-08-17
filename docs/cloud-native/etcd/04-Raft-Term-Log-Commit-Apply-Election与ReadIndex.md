---
title: "Raft Term、Log、Commit、Apply、Election 与 ReadIndex"
sidebar_position: 4
tags: [etcd, Raft, ReadIndex, Consensus]
description: "从提案、日志复制、Commit、Apply 到线性读理解 etcd Raft。"
---

# Raft Term、Log、Commit、Apply、Election 与 ReadIndex

```text
client proposal → leader appends log
→ replicate to followers
→ majority acknowledge → commit index advances
→ each member applies committed entries to MVCC/backend
→ response according to request path
```

## Term/Election

Term 是领导任期。Follower election timeout 到期发起竞选，获得多数票成为 Leader。网络/磁盘抖动会造成频繁选举；时钟无需严格同步保证安全，但调度暂停和网络延迟影响活性。

## Commit 与 Apply

Log 已写不等于 committed；Committed 不等于每个 follower 已 apply。`raft index` 与 `raft applied index` 差距反映 apply backlog。不要根据单节点 WAL 文件推断集群已提交。

## 线性读

线性化读需要确认当前 Leader/多数派状态，ReadIndex 可避免每次读写入日志；串行化读可由本地状态机返回，可能陈旧但更快。关键锁/选主读使用线性语义。

## 多数派故障

三节点失去两个成员不能安全写，也不能通过启动一个旧快照成员强行组成“多数”。先恢复原成员或按灾难恢复流程建立新集群。

## 验收题

- Append、Commit、Apply 有何区别？
- 为什么多数派决定写可用性？
- ReadIndex 解决什么？
- 串行化读适合什么场景？

## 参考资料

- [Raft paper](https://raft.github.io/raft.pdf)
- [etcd Raft](https://etcd.io/docs/v3.6/learning/why/)
