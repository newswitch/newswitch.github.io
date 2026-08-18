---
title: "etcd 从零到精通学习路线"
sidebar_label: "00. etcd 从零到精通学习路线"
sidebar_position: 0
description: "以 etcd 3.6 为主线，从 KV、Revision、Watch、Lease 深入 Raft、WAL、Snapshot、线性一致读、集群维护、灾难恢复和源码。"
tags: [etcd, Raft, MVCC, Kubernetes, 学习路线]
---

# etcd 从零到精通学习路线

etcd 不是一个“给 Kubernetes 存 YAML 的小数据库”。它是强一致分布式 KV，Revision、MVCC、Watch、Lease、Txn、Raft、WAL、Snapshot、Compaction 和 Defrag 共同决定控制面的正确性与延迟。etcd 出问题时，最危险的不是单次请求慢，而是整个控制面无法安全推进状态。

本路线以 **etcd 3.6** 为主线，Kubernetes 使用的具体 etcd 版本以发行版兼容矩阵为准。

## 1. 一次写入和读取

```text
Client Put
  → gRPC / auth / quota
  → Leader proposal
  → Raft log replication to quorum
  → commit / apply
  → MVCC revision / BoltDB backend
  → watch notification
  → response

Linearizable Read
  → quorum/leader read barrier
  → applied state
  → response
```

## 2. 篇文章学习清单 {/* #2-13-篇文章学习清单 */}

| 编号 | 文章 | 优先级 | 收录情况 |
| --- | --- | --- | --- |
| T00 | etcd 从零到精通学习路线 | P0 | 已收录 |
| T01 | [etcd 架构、Raft 与 Kubernetes 控制面](../kubernetes/architecture/03-Etcd解析.md) | P0 | 已收录 |
| T02 | [Key、Revision、MVCC、Range、Txn 与 Compare-And-Swap](./02-etcd-Key-Revision-MVCC-Range-Txn与CAS.md) | P0 | 已收录 |
| T03 | [Watch、Lease、TTL、Lock 与 Leader Election](./03-etcd-Watch-Lease-TTL-Lock与Leader-Election.md) | P0 | 已收录 |
| T04 | [Raft Term、Log、Commit、Apply、Election 与 ReadIndex](./04-Raft-Term-Log-Commit-Apply-Election与ReadIndex.md) | P0 | 已收录 |
| T05 | [WAL、Snapshot、bbolt、Compaction、Defrag 与 Quota](./05-etcd-WAL-Snapshot-bbolt-Compaction-Defrag与Quota.md) | P0 | 已收录 |
| T06 | [三/五节点静态、TLS、systemd、Docker 与 StatefulSet 部署](./06-etcd三五节点静态TLS-systemd-Docker与StatefulSet部署.md) | P0 | 已收录 |
| T07 | [Member Add/Remove/Replace、Learner、扩缩和滚动升级](./07-etcd成员变更Learner扩缩与滚动升级.md) | P1 | 已收录 |
| T08 | [Snapshot Backup/Restore、Revision Bump 与灾难恢复](./08-etcd-Snapshot-Restore-Revision-Bump与灾难恢复.md) | P0 | 已收录 |
| T09 | [线性/串行读、延迟、吞吐、磁盘 fsync 与容量规划](./09-etcd读一致性延迟吞吐fsync与容量规划.md) | P1 | 已收录 |
| T10 | [TLS、Authentication、Role、Network Isolation 与审计](./10-etcd-TLS认证Role网络隔离与审计.md) | P1 | 已收录 |
| T11 | [Kubernetes etcd 备份、控制面故障和恢复边界](./11-Kubernetes-etcd备份控制面故障与恢复边界.md) | P1 | 已收录 |
| T12 | [etcdctl 命令、监控、空间告警与故障 Runbook](../kubernetes/commands/10-etcdctl命令详解.md) | P1 | 已收录 |

当前路线收录 13 篇文章。是否掌握应以能解释写入/读取路径、完成多数派故障实验、独立恢复快照并验证 Kubernetes Watch 行为为准，而不是以文章文件是否存在判断。

## 3. 关键一致性概念

```text
Revision：全局逻辑修改序号，不是单 Key 版本号
MVCC：保留历史 Revision 以支持一致读取和 Watch
Raft Commit：多数派接受日志
Apply：状态机已经应用提交项
Linearizable Read：读取不落后于已确认写
Serializable Read：可从本地状态读取，可能陈旧
```

### 3.1 为什么必须使用奇数节点 {/* #为什么必须使用奇数节点 */}

三节点容忍一个故障，五节点容忍两个故障；四节点仍只能容忍一个，却增加写入多数派和运维成本。跨故障域分布要同时考虑网络延迟与同时故障，不是节点越多越好。

## 4. P0 验收题

- Raft Leader 收到写入后，在哪个时间点才能安全返回成功？
- WAL 已有记录但状态机未 Apply，重启后会发生什么？
- Watch 从一个已 Compacted Revision 开始会得到什么结果？
- Lease 到期通知延迟是否等于 TTL 精确计时器？
- Compaction 与 Defrag 分别回收逻辑历史和物理文件什么空间？
- 为什么慢磁盘会让整个 etcd 集群和 Kubernetes 控制面抖动？
- Snapshot 成功后，恢复为什么还需要处理集群身份和 Revision？
- 失去多数派后能否强行让单节点继续写？代价是什么？

## 5. 实验拓扑

```text
单节点：KV、Revision、Txn、Watch、Lease、Compaction
三节点：Election、quorum、网络分区、member replace
五节点：故障域和多数派延迟比较
Kubernetes 控制面：API Server → etcd 写入与 Watch
灾备：snapshot → new cluster restore → revision/consumer verification
```

## 6. 运维红线

- 不把 etcd 数据目录放在高延迟共享存储上而不做 fsync 基准；
- 不通过复制运行中的数据目录代替 Snapshot；
- 不同时移除多个成员；
- 不在失去多数派时用错误集群参数启动两个独立写集群；
- 不只备份 Snapshot 而从未恢复 Kubernetes 对象和控制器状态；
- 不把公网、业务高吞吐或大对象直接放入 etcd。

## 7. 官方资料

- [etcd 3.6 Documentation](https://etcd.io/docs/v3.6/)
- [etcd Operations Guide](https://etcd.io/docs/v3.6/op-guide/)
- [etcd Source](https://github.com/etcd-io/etcd)

etcd 路线最终要能回答：一次 Kubernetes 对象更新怎样转化为 Raft 日志、Revision 和 Watch 事件，以及磁盘/网络故障在哪个时间点阻止控制面继续前进。
