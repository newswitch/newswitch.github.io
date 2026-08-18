---
title: "Keeper/Raft、复制队列、选主、故障恢复和扩缩容"
sidebar_label: "11. Keeper/Raft、复制队列、选主、故障恢复和扩缩容"
sidebar_position: 11
description: "理解 Keeper 元数据、Part 复制任务、Replica leader、只读状态和安全扩缩。"
tags: [ClickHouse, Keeper, Raft, Replication Queue]
---

# Keeper/Raft、复制队列、选主、故障恢复和扩缩容

Keeper 通过 Raft 保存复制元数据、DDL 队列等协调状态，不传输完整 Part；Replica 从其他副本/对象存储拉 Part。

## 1. 复制队列 {/* #复制队列 */}

Insert 后 Part 注册，其他 Replica 生成 fetch/merge/mutate 等任务。`system.replicas` 的 queue_size、absolute_delay、active_replicas 和 `system.replication_queue` 是核心证据。

Replica leader 主要协调 Merge/任务，不是所有查询写入的单主。多个副本可读写，复制最终收敛；业务幂等和 quorum insert 设置需按一致性目标验证。

## 2. 故障 {/* #故障 */}

Keeper 少数成员故障只要多数派健康可继续；失去 quorum 会影响新复制/DDL。Replica Keeper Session 失效可能变只读。磁盘慢、网络、认证、路径冲突分别排查，不能清 Keeper 路径“重建”。

## 3. 扩缩 {/* #扩缩 */}

新 Replica 建同 Keeper 路径/唯一 replica name 并拉取全部 Part；需容量和带宽。移除前确认数据冗余、停止写入该身份、清理 table replica metadata 使用官方命令。加 Shard 需数据再平衡方案。

## 4. Keeper 运维闭环 {/* #keeper-运维闭环 */}

Keeper 集群使用奇数投票节点并分布在独立故障域。记录 `clickhouse-keeper` 版本、server_id、Raft 配置和 snapshot/log 存储，再执行单节点停止、leader 切换和滚动重启，验证 ClickHouse DDL/复制队列是否继续工作。

```bash
echo mntr | nc <keeper-host> 9181
echo srvr | nc <keeper-host> 9181
```

具体 four-letter command 与白名单以当前版本配置为准。排障保存 leader/term、延迟、未提交日志、磁盘 fsync、snapshot、网络和客户端 session。失去多数派时应恢复原节点/网络，而不是在两侧分别强制成新集群。

成员变更必须一次一个并确认配置提交；备份要和 ClickHouse 元数据/数据恢复方案一起演练。直接删除 Keeper 路径会破坏复制状态，不是清理队列的常规手段。

## 5. 验收题 {/* #验收题 */}

- Keeper 是否传输列数据？
- Replica leader 与传统数据库主库有何不同？
- Keeper 失去多数派会影响哪些操作？
- 新 Replica 为什么可能压垮旧节点网络？

## 6. 参考资料 {/* #参考资料 */}

- [ClickHouse Keeper](https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper)
- [Replication queue](https://clickhouse.com/docs/operations/system-tables/replication_queue)
