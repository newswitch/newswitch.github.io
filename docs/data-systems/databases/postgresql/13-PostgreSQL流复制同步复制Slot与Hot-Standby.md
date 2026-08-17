---
title: "流复制、同步复制、Replication Slot 与 Hot Standby"
sidebar_label: "13. 流复制、同步复制、Replication Slot 与 Hot Standby"
sidebar_position: 13
tags: [PostgreSQL, Streaming Replication, Replication Slot]
description: "理解 WAL Sender/Receiver、同步提交、复制槽、只读冲突和 RPO。"
---

# 流复制、同步复制、Replication Slot 与 Hot Standby

```text
primary WAL → walsender → network → walreceiver
→ write/flush → startup process replay → standby queries
```

接收、写入、刷盘、重放是四个位置。复制延迟要分别看 LSN gap 与时间，不能只用一个秒数。

## 异步与同步

异步复制主库提交不等待副本，主故障可能丢未到达 WAL。同步复制按 `synchronous_standby_names` 和 `synchronous_commit` 等待指定阶段，可降低 RPO，但副本/网络慢会进入主事务 P99。

## Replication Slot

物理 Slot 防止主库删除副本尚需 WAL；副本长期离线会让 `pg_wal` 无限增长直到磁盘满。设置容量上限/告警，废弃 Slot 需先确认消费者身份和恢复策略再删除。

## Hot Standby 冲突

副本查询可能需要已被主库 Vacuum 回收的版本，恢复与查询发生冲突。可取消查询、延迟重放或反馈 xmin；后两者会增加延迟或主库膨胀。报表查询应有时限。

## 提升与旧主

Promote 创建新 Timeline。旧主恢复前需 `pg_rewind` 或重新 base backup，并用 fencing 确保它不再接受写，防止双主。

## 验收题

- write/flush/replay LSN 分别代表什么？
- 同步复制如何把副本问题传给主库延迟？
- Slot 为什么可能填满磁盘？
- Hot Standby feedback 的代价是什么？

## 参考资料

- [Warm standby](https://www.postgresql.org/docs/18/warm-standby.html)
- [Replication slots](https://www.postgresql.org/docs/18/warm-standby.html#STREAMING-REPLICATION-SLOTS)
