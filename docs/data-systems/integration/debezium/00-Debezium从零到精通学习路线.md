---
title: "Debezium 从零到精通学习路线"
sidebar_label: "00. Debezium 从零到精通学习路线"
sidebar_position: 0
description: "从数据库事务日志到变更事件，系统学习 Snapshot、Offset、Schema History、事务、部署、重建和生产排障。"
tags: [Debezium, CDC, Kafka Connect, Snapshot, Schema History]
---

# Debezium 从零到精通学习路线

Debezium 不是定时查询表的同步脚本。它先建立一致的初始快照，再持续读取 MySQL Binlog、PostgreSQL WAL 等数据库事务日志，把行级变化转换为有来源位置和 Schema 的事件。Offset 和 Schema History 是恢复正确性的核心状态，不能当普通缓存随意删除。

```text
Database Commit
→ Binlog/WAL
→ Debezium Source Connector
→ Snapshot/Streaming协调
→ Event Envelope与Schema
→ Kafka Connect或Debezium Server
→ Kafka/其他Sink
→ Consumer幂等落地
```

## 1. P0：CDC 路径与状态

1. [Debezium 解决什么问题与一条变更事件的完整路径](./01-Debezium解决什么问题与一条变更事件的完整路径.md)
2. [Kafka Connect Worker、Connector、Task、REST API 与生命周期](./02-Kafka-Connect-Worker-Connector-Task-REST-API与生命周期.md)
3. [Initial、Schema-only、Never、When-needed 与 Incremental Snapshot](./03-Initial-Schema-only-Never-When-needed与Incremental-Snapshot.md)
4. [Source Offset、Offset Store、Schema History 与恢复边界](./04-Source-Offset-Offset-Store-Schema-History与恢复边界.md)
5. [Event Envelope、Key、before/after、Delete、Tombstone 与时间字段](./05-Event-Envelope-Key-before-after-Delete-Tombstone与时间字段.md)
6. [事务边界、顺序、Exactly-once 边界与 Transactional Outbox](./06-事务边界-顺序-Exactly-once边界与Transactional-Outbox.md)

## 2. P1：数据库、部署与生产治理

7. [MySQL Binlog、GTID、权限、快照锁、故障转移与 Connector 参数](./07-MySQL-Binlog-GTID-权限-快照锁-故障转移与Connector参数.md)
8. [PostgreSQL Logical Decoding、Slot、Publication、WAL 保留与故障恢复](./08-PostgreSQL-Logical-Decoding-Slot-Publication-WAL保留与恢复.md)
9. [DDL、Schema Evolution、Avro/Protobuf、Schema Registry 与消费者兼容](./09-DDL-Schema-Evolution-Avro-Protobuf-Schema-Registry与兼容.md)
10. [Kafka Connect、Debezium Server/Engine、Operator 与 Kubernetes 部署](./10-Kafka-Connect-Debezium-Server-Engine-Operator与Kubernetes部署.md)
11. [Lag、Queue、Snapshot、JMX/OTel、容量、安全、HA 与告警](./11-Lag-Queue-Snapshot-JMX-OTel-容量-安全-HA与告警.md)

## 3. P2：重建和故障处理

12. [Resnapshot、增量补表、Offset 重置、Topic 重建、升级与迁移](./12-Resnapshot-增量补表-Offset重置-Topic重建-升级与迁移.md)
13. [Debezium 生产故障 Runbook](./13-Debezium生产故障Runbook.md)

## 4. 已有补充阅读

- [Debezium CDC、Binlog、快照与 Schema Change](../../big-data/engineering-governance/01-Debezium-CDC-Binlog快照与Schema-Change.md)
- [Debezium CDC、Transactional Outbox 与 Schema Change](../../databases/mysql/08-production-operations/03-Debezium-CDC-TransactionalOutbox与SchemaChange.md)

## 5. 必做实验

- 在 Snapshot 期间持续写数据库，验证快照与增量无缝衔接；
- 停止 Connector 后继续写入，再从 Offset 恢复；
- 删除测试 Offset/Schema History，观察为什么不能简单续跑；
- 执行 INSERT、UPDATE、DELETE 和 DDL，解读 Envelope；
- 制造消费者重复处理，使用事件 Key 和来源位置实现幂等；
- 阻断 Kafka、填满内部 Queue、暂停数据库日志清理；
- 让 PostgreSQL Slot 长期不消费，观察 WAL 增长；
- 完成新增大表的 Incremental Snapshot；
- 演练数据库主从切换、Connector 重启、版本升级和回滚。

## 6. 学习完成标准

- 能画出提交事务到下游事件的完整路径；
- 能说明 Snapshot Low/High Watermark 与增量衔接；
- 能区分 Source Offset、Kafka Connect Offset 和 Schema History；
- 能解释至少一次、重复事件和消费者幂等；
- 能处理 DDL、Delete/Tombstone、重建与补表；
- 能规划日志保留、Lag、队列、连接和生产容量；
- 能定位是数据库、Connector、Kafka 还是消费者问题。

参考：[Debezium Architecture](https://debezium.io/documentation/reference/stable/architecture.html)、[Storing Connector State](https://debezium.io/documentation/reference/stable/configuration/storage.html)。
