---
title: "Debezium 事务边界、顺序、Exactly-once 边界与 Transactional Outbox"
sidebar_label: "06. 事务、顺序与 Outbox"
sidebar_position: 6
description: "理解数据库事务如何映射为 CDC 事件，以及至少一次、Exactly-once 和 Transactional Outbox 的真实边界。"
tags: [Debezium, Transaction, Exactly Once, Outbox]
---

# Debezium 事务边界、顺序、Exactly-once 边界与 Transactional Outbox

数据库一次提交可以修改多张表、很多行。CDC 会把它拆成多条消息，链路上任何重试还可能使消息重复。因此“数据库已提交”不自动等于“所有下游只生效一次”。

## 1. 事务从数据库到 Kafka

```text
BEGIN
→ 多条行变更写入事务日志
→ COMMIT形成可见边界
→ Debezium按日志顺序读取
→ 产生行级事件与可选事务元数据
→ Kafka分区保存局部顺序
→ 消费者提交自己的处理进度
```

事务元数据可给事件附带事务 ID、总事件数和顺序，但它不能让任意外部系统自动获得原数据库的 ACID 事务。

## 2. Exactly-once 要问清范围

| 范围 | 可达到的含义 | 仍然存在的风险 |
| --- | --- | --- |
| 数据库日志读取 | 从确认位置继续 | 提交间隔导致重放 |
| Kafka Connect 到 Kafka | 特定部署与配置下事务性写入 | 不是所有连接器/架构都相同 |
| Kafka 消费与 Kafka 输出 | Kafka 事务可原子处理 | 外部 API/数据库不在事务内 |
| 端到端业务结果 | 依赖幂等、去重或业务事务 | 无通用开关一键保证 |

生产设计应默认消息至少一次，明确重复窗口，而不是用“EOS”三个字掩盖系统边界。

## 3. Transactional Outbox

业务事务同时修改业务表和 Outbox 表：

```sql
BEGIN;
UPDATE orders SET status='PAID' WHERE id=7;
INSERT INTO outbox(id, aggregate_type, aggregate_id, event_type, payload)
VALUES ('evt-123', 'Order', '7', 'OrderPaid', '{...}');
COMMIT;
```

Debezium 只捕获 Outbox，再通过 Outbox Event Router 把 `aggregate_id` 作为消息 Key。这样避免“数据库提交成功但发消息失败”的双写问题。它保证事件与业务状态同事务产生，不保证消费者绝不重复。

## 4. 消费幂等

可选方案包括：目标表用业务 Key Upsert；维护已处理 `event_id` 唯一约束；比较来源日志位置只接受更新版本；同一数据库内把业务写入和消费 Offset 一起提交。

去重表也要有保留周期。保留期必须覆盖消息最大重试、重放和灾备恢复窗口，否则旧事件重放后仍会重复生效。

## 5. 必做故障实验

1. Kafka 写入成功后、Offset 提交前强杀 Connector；
2. 消费者调用外部接口成功后、提交 Offset 前崩溃；
3. 一个事务更新多个分区的 Key，观察到达顺序；
4. Outbox 产生重复事件，验证唯一键去重；
5. 对账业务表最终状态、Outbox 数量和下游结果。

参考：[Debezium Transaction Metadata](https://debezium.io/documentation/reference/stable/connectors/mysql.html#mysql-transaction-metadata)、[Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)。
