---
title: "Keeper/Raft、复制队列、选主、故障恢复和扩缩容"
sidebar_label: "11. Keeper/Raft、复制队列、选主、故障恢复和扩缩容"
sidebar_position: 11
tags: [ClickHouse, Keeper, Raft, Replication Queue]
description: "理解 Keeper 元数据、Part 复制任务、Replica leader、只读状态和安全扩缩。"
---

# Keeper/Raft、复制队列、选主、故障恢复和扩缩容

Keeper 通过 Raft 保存复制元数据、DDL 队列等协调状态，不传输完整 Part；Replica 从其他副本/对象存储拉 Part。

## 复制队列

Insert 后 Part 注册，其他 Replica 生成 fetch/merge/mutate 等任务。`system.replicas` 的 queue_size、absolute_delay、active_replicas 和 `system.replication_queue` 是核心证据。

Replica leader 主要协调 Merge/任务，不是所有查询写入的单主。多个副本可读写，复制最终收敛；业务幂等和 quorum insert 设置需按一致性目标验证。

## 故障

Keeper 少数成员故障只要多数派健康可继续；失去 quorum 会影响新复制/DDL。Replica Keeper Session 失效可能变只读。磁盘慢、网络、认证、路径冲突分别排查，不能清 Keeper 路径“重建”。

## 扩缩

新 Replica 建同 Keeper 路径/唯一 replica name 并拉取全部 Part；需容量和带宽。移除前确认数据冗余、停止写入该身份、清理 table replica metadata 使用官方命令。加 Shard 需数据再平衡方案。

## 验收题

- Keeper 是否传输列数据？
- Replica leader 与传统数据库主库有何不同？
- Keeper 失去多数派会影响哪些操作？
- 新 Replica 为什么可能压垮旧节点网络？

## 参考资料

- [ClickHouse Keeper](https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper)
- [Replication queue](https://clickhouse.com/docs/operations/system-tables/replication_queue)
