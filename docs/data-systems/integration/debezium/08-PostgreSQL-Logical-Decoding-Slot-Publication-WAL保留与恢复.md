---
title: "Debezium PostgreSQL：Logical Decoding、Slot、Publication、WAL 保留与恢复"
sidebar_label: "08. PostgreSQL Connector 生产实践"
sidebar_position: 8
description: "理解 PostgreSQL Logical Decoding 数据路径、Replication Slot 生命周期、WAL 容量和故障恢复。"
tags: [Debezium, PostgreSQL, WAL, Replication Slot]
---

# Debezium PostgreSQL：Logical Decoding、Slot、Publication、WAL 保留与恢复

PostgreSQL 通过 Logical Decoding 把 WAL 解码为逻辑行变更。Publication 决定发布哪些表，Replication Slot 保存消费进度并阻止所需 WAL 被清理。Slot 能保数据，也可能在连接器停机时填满磁盘。

## 1. 数据路径

```text
事务COMMIT
→ WAL
→ Publication定义表范围
→ Logical Replication Slot + pgoutput解码
→ Debezium读取并确认LSN
→ Kafka
→ confirmed_flush_lsn推进
```

`restart_lsn` 附近是 Slot 仍需保留的最早 WAL，`confirmed_flush_lsn` 表示消费者确认到的位置。两者与当前 WAL LSN 的差值共同反映保留压力。

## 2. 前置配置

启用 `wal_level=logical`，规划 `max_replication_slots`、`max_wal_senders` 和 WAL 容量；创建最小权限复制用户、Publication 与唯一 Slot。云数据库还要核对服务商对逻辑复制、故障切换 Slot 和参数修改的限制。

```sql
SELECT slot_name, active, restart_lsn, confirmed_flush_lsn,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;
```

不要在连接器仍可能恢复时随意删除 Slot。删除后数据库不再为它保留 WAL，原 Offset 很可能失效。

## 3. Publication 与 Schema

Publication 可由连接器自动创建，也可由 DBA 管理。生产环境建议明确所有权和变更流程：新增表后同时检查 Replica Identity、Publication 成员、权限和下游 Schema 兼容。

无主键表的 UPDATE/DELETE 可能缺乏稳定 Key。`REPLICA IDENTITY FULL` 能提供更多旧值，但增加 WAL 量；优先从业务模型上提供主键。

## 4. 容量与告警

WAL 增长速率约等于业务写入产生 WAL 的速率。停机安全窗口近似：

```text
可用WAL空间 / 峰值WAL生成速率
```

必须对 retained bytes、Slot inactive 时长、磁盘使用率、Connector LSN Lag 和数据库事务率同时告警。只看 Connector Running 会漏掉 Slot 堆积。

## 5. 故障切换

传统主备切换后 Slot 未必自动存在或具有相同进度。切换前确认 PostgreSQL 版本与托管平台是否支持 Slot 同步/故障转移；否则记录 LSN，设计重建、重复区间与对账策略。切换后检查 Timeline、Publication、Slot、已确认 LSN，再恢复消费。

## 6. Runbook

Slot 膨胀时先确认对应 Connector 是否仍需恢复，再看 Kafka 背压与 Connector 错误。若业务磁盘紧急，扩容/限流通常比直接删 Slot 更安全。任何重建都要记录旧 Offset、最早 WAL、影响表和下游幂等能力。

参考：[Debezium PostgreSQL Connector](https://debezium.io/documentation/reference/stable/connectors/postgresql.html)、[PostgreSQL Logical Decoding](https://www.postgresql.org/docs/current/logicaldecoding.html)。
