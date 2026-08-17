---
title: "Debezium CDC、Transactional Outbox 与 Schema Change"
sidebar_position: 3
tags: [MySQL, Debezium, CDC, Outbox, Schema Evolution]
description: "理解从一致性快照、Binlog、offset、Schema History 到消费者幂等和 Outbox 的端到端 CDC 语义。"
---

# Debezium CDC、Transactional Outbox 与 Schema Change

CDC 把数据库提交变更转成事件流：

```text
MySQL transaction commit
→ binlog
→ Debezium snapshot/stream
→ Kafka Connect offset + schema history
→ topic event
→ consumer side effect
```

它减少轮询，却不自动提供端到端 exactly-once 业务副作用。

## 1. 前置设计

核对 Debezium 稳定版本对 MySQL 的兼容，配置 Row Binlog、row image、GTID/保留、唯一 server ID、最小复制权限与 TLS。Binlog 保留必须覆盖连接器最长停机和恢复时间，否则 offset 指向已清理日志。

## 2. 初始快照

初始快照建立当前数据基线和与 Binlog 对齐的位置，然后继续流式读取。大表快照会产生长读、I/O 和网络压力；选择 blocking/incremental/自定义模式前明确锁、一致性和重复事件行为。

## 3. Schema History

连接器需要知道某个 Binlog 事件发生时的表结构。内部 schema history topic 是连接器恢复状态的一部分，应单分区保持全局顺序、备份/高可用并限制访问，不能当普通业务 Topic 清理或随意重建。

## 4. 事件语义

事件包含 key、before/after、操作类型和 source 元数据。主键应稳定；无主键表的分区、去重和更新语义更困难。删除可能伴随 delete 与 tombstone，消费者必须理解所用转换和 compact 策略。

Kafka Connect 故障恢复可能重复产生已处理事件。消费者使用事件身份/业务幂等键、幂等 upsert、去重表或事务性消费设计，不依赖“理论上只来一次”。

## 5. Transactional Outbox

应用在同一 MySQL 本地事务中更新业务表并插入 outbox：

```sql
START TRANSACTION;
UPDATE orders SET status='PAID' WHERE id=?;
INSERT INTO outbox_events
  (event_id, aggregate_id, event_type, payload, created_at)
VALUES (?, ?, 'OrderPaid', ?, NOW(6));
COMMIT;
```

Debezium 发布 outbox 行，避免“数据库提交成功但消息没发”双写窗口。消费者仍需幂等；outbox 还需要分区键、Schema 版本、归档和敏感 payload 治理。

## 6. Schema Change

遵循 expand/contract：先新增兼容列/事件字段 → 生产者双兼容 → 消费者升级 → 回填 → 最后删除旧字段。DDL 工具生成的影子表/rename 可能影响捕获规则和 Schema History，必须在预生产用真实变更演练。

## 7. 监控

快照进度、最后事件年龄、Binlog position/GTID、source-to-connector lag、Kafka producer/queue、Schema History、错误/重启、Topic 消费积压。数据库复制延迟和 CDC 延迟是不同链路。

## 8. 故障 Runbook

连接器停机先保护 Binlog；保存 offset、配置和 history 状态；判断是数据库、权限、DDL 解析、Kafka 还是消费者；禁止未经验证地清 offset/history 触发全量重放。恢复后检查重复、缺口和下游一致性。

## 参考资料

- [Debezium MySQL Connector](https://debezium.io/documentation/reference/stable/connectors/mysql.html)
- [Debezium Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)
