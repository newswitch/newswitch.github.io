---
title: "Debezium Event Envelope、Key、before/after、Delete、Tombstone 与时间字段"
sidebar_label: "05. 变更事件结构与删除语义"
sidebar_position: 5
description: "逐字段解读 Debezium 事件，正确处理主键、更新、删除、墓碑、时间与来源位置。"
tags: [Debezium, Event Envelope, Tombstone, CDC]
---

# Debezium Event Envelope、Key、before/after、Delete、Tombstone 与时间字段

消费 CDC 事件不能只取 `after`。Key 决定 Kafka 分区和状态归并，`op` 决定动作，`source` 是审计与幂等依据，Tombstone 则服务于 Compacted Topic 的键清理。

## 1. 典型结构

```json
{
  "before": {"id": 7, "status": "NEW"},
  "after": {"id": 7, "status": "PAID"},
  "source": {"db": "shop", "table": "orders", "file": "mysql-bin.000123", "pos": 456},
  "op": "u",
  "ts_ms": 1780000000123
}
```

| 字段 | 含义 | 消费注意 |
| --- | --- | --- |
| Key | 通常来自主键 | 无主键表的顺序和归并更困难 |
| `before` | 变化前的行 | 数据库配置可能只提供部分旧值 |
| `after` | 变化后的行 | 删除事件通常为空 |
| `op` | `c/u/d/r` | `r` 是快照读，不是新建业务动作 |
| `source` | 数据库与日志来源 | 用于审计、去重和定位 |
| `ts_ms/us/ns` | 事件处理或来源时间 | 不等同于消费者收到时间 |

## 2. 删除为什么可能有两条消息

第一条是 `op=d` 的删除事件，Key 仍是被删行的主键；随后可产生同 Key、Value 为 `null` 的 Tombstone，让 Kafka Log Compaction 清除该键的旧值。若 Sink 要做物理删除，应处理删除事件；若只是维护 Kafka 最新状态，还要理解 Tombstone。

SMT 可以改写或丢弃 Tombstone，但改之前必须明确 Topic 是审计日志、状态表还是中间交换格式。

## 3. 主键变化

主键更新不是普通字段更新。它通常表现为旧 Key 删除和新 Key 创建，并可能带有 Header 关联。下游若只按 `after.id` Upsert，可能留下旧 Key 脏数据。生产测试必须覆盖主键修改，即使业务声称“不会发生”。

## 4. 顺序边界

相同 Kafka Partition 内有顺序；跨 Partition 没有全局到达顺序。稳定主键能让同一实体进入同一 Partition，但跨行事务仍需事务元数据或下游事务协调。不要用 `ts_ms` 对所有事件全局排序：时钟、批处理和重试都会破坏这种假设。

## 5. Schema 与类型

DECIMAL、时间、二进制、无符号整数和 JSON 的编码受 Connector 配置与 Converter 影响。先定义数据契约，再选择 JSON、Avro 或 Protobuf；消费者必须区分字段缺失、字段为 `null`、Schema 默认值三种情况。

## 6. 消费者验收清单

- 覆盖 `c/u/d/r` 和 Tombstone；
- 以 Event Key 而不是展示字段分区；
- 保存 Source Position 供审计和幂等；
- 对重复事件重复执行结果不变；
- 能处理新增可空字段和兼容 Schema；
- 对乱序、重试、DLQ 和 poison event 有明确策略。

参考：[Debezium Change Event Values](https://debezium.io/documentation/reference/stable/connectors/mysql.html#mysql-change-events-value)、[Event Flattening SMT](https://debezium.io/documentation/reference/stable/transformations/event-flattening.html)。
