---
title: "Transaction Log、Snapshot、dataLogDir、Autopurge 与磁盘恢复"
sidebar_label: "09. 日志、快照与磁盘恢复"
sidebar_position: 9
description: "解释 ZooKeeper 事务日志和快照的恢复关系、目录规划、自动清理以及磁盘故障处置。"
tags: [ZooKeeper, Transaction Log, Snapshot, Autopurge, 恢复]
---

# Transaction Log、Snapshot、dataLogDir、Autopurge 与磁盘恢复

ZooKeeper 把已提交状态保存在内存数据树中，同时通过事务日志和周期性快照实现重启恢复。快照通常是模糊快照，启动时还要重放后续事务日志才能得到一致状态。

## 1. 写入与恢复路径

```text
写事务
→ append Transaction Log
→ 多数派提交
→ 应用到DataTree
→ 周期性Snapshot

重启
→ 读取最新可用Snapshot
→ 重放其后的Transaction Log
→ 恢复DataTree
```

`dataDir` 保存快照和 `myid` 等状态，`dataLogDir` 可把顺序事务日志放在独立低延迟设备上。两者如果共享拥塞磁盘，日志 fsync、快照和系统其他 I/O 会相互影响。

## 2. Autopurge

事务日志和快照不会因为“数据很小”就永远不增长。配置保留数量和清理间隔，或使用官方清理工具；必须至少保留可配对恢复的一组快照与日志，并满足审计/备份要求。

不要用通配符手工删除最新文件。清理前先识别文件 zxid/时间、当前进程使用情况和备份策略。

## 3. 磁盘故障判断

| 现象 | 可能原因 |
| --- | --- |
| 写延迟突增 | 事务日志盘 fsync 慢、队列深度高 |
| 启动时间很长 | Snapshot 大、需重放日志多、磁盘慢 |
| 无法创建日志/快照 | 磁盘满、权限、只读文件系统 |
| 节点反复退出同步集 | I/O 延迟导致心跳或同步超时 |

先检查文件系统、inode、挂载、权限、延迟和内核错误。不要在多数派不明确时复制不同节点的数据目录相互覆盖。

## 4. 备份和恢复

备份应在一致流程下保存配置、`myid` 映射、动态成员配置、Snapshot 和必要的 Transaction Log。恢复优先从健康多数派重新同步单个节点；只有 Ensemble 整体灾难时才使用离线备份重建。

恢复验收包括：ZNode 数量与关键路径、ACL、数据版本、zxid、Ephemeral 是否由活跃会话重新注册，以及应用协调功能。

## 5. 演练

创建持续写入负载，生成多个 Snapshot/日志后停止一个 Follower；备份其目录并清空测试副本，再让它从健康 Ensemble 同步。另在隔离环境执行备份恢复，记录启动重放时间与实际 RPO/RTO。

参考：[ZooKeeper Administrator's Guide—Data File Management](https://zookeeper.apache.org/doc/current/zookeeperAdmin.html#sc_dataFileManagement)。
