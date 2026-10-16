---
title: "流复制、同步复制、Replication Slot 与 Hot Standby"
sidebar_label: "13. 流复制、同步复制、Replication Slot 与 Hot Standby"
sidebar_position: 13
description: "理解 WAL Sender/Receiver、同步提交、复制槽、只读冲突和 RPO。"
tags: [PostgreSQL, Streaming Replication, Replication Slot]
---

# 流复制、同步复制、Replication Slot 与 Hot Standby

```text
primary WAL → walsender → network → walreceiver
→ write/flush → startup process replay → standby queries
```

接收、写入、刷盘、重放是四个位置。复制延迟要分别看 LSN gap 与时间，不能只用一个秒数。

## 1. 异步与同步 {/* #异步与同步 */}

异步复制主库提交不等待副本，主故障可能丢未到达 WAL。同步复制按 `synchronous_standby_names` 和 `synchronous_commit` 等待指定阶段，可降低 RPO，但副本/网络慢会进入主事务 P99。

## 2. Replication Slot {/* #replication-slot */}

物理 Slot 防止主库删除副本尚需 WAL；副本长期离线会让 `pg_wal` 无限增长直到磁盘满。设置容量上限/告警，废弃 Slot 需先确认消费者身份和恢复策略再删除。

## 3. Hot Standby 冲突 {/* #hot-standby-冲突 */}

副本查询可能需要已被主库 Vacuum 回收的版本，恢复与查询发生冲突。可取消查询、延迟重放或反馈 xmin；后两者会增加延迟或主库膨胀。报表查询应有时限。

## 4. 提升与旧主 {/* #提升与旧主 */}

Promote 创建新 Timeline。旧主恢复前需 `pg_rewind` 或重新 base backup，并用 fencing 确保它不再接受写，防止双主。

## 5. 复制一致性与 RPO 实验 {/* #复制一致性与-rpo-实验 */}

```sql
SELECT application_name, state, sync_state,
       write_lag, flush_lag, replay_lag
FROM pg_stat_replication;
SELECT slot_name, active, restart_lsn, wal_status, safe_wal_size
FROM pg_replication_slots;
SELECT pg_is_in_recovery(), pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();
```

持续写入序号数据，分别注入 standby 网络延迟、暂停 replay、主库故障和只读长查询，记录 WAL 产生/接收/flush/replay 差异以及实际 RPO。同步复制确认到 remote_write/flush/apply 的语义不同，并以可用性和写延迟为代价。

物理 slot 可防止主库过早回收 WAL，但失联副本会无限占盘，应告警 retained WAL 并设置策略。Hot Standby 查询可能与恢复冲突；延迟回放和 `hot_standby_feedback` 会转移为主库膨胀风险。切换前必须 fencing 旧主，确认 timeline 和应用连接，不能只提升副本就认为安全。

## 6. 验收题 {/* #验收题 */}

- write/flush/replay LSN 分别代表什么？
- 同步复制如何把副本问题传给主库延迟？
- Slot 为什么可能填满磁盘？
- Hot Standby feedback 的代价是什么？

## 7. 参考资料 {/* #参考资料 */}

- [Warm standby](https://www.postgresql.org/docs/18/warm-standby.html)
- [Replication slots](https://www.postgresql.org/docs/18/warm-standby.html#STREAMING-REPLICATION-SLOTS)
