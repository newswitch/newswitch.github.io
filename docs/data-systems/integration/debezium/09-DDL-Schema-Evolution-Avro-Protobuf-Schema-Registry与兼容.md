---
title: "Debezium DDL、Schema Evolution、Avro、Protobuf 与 Schema Registry"
sidebar_label: "09. Schema 演进与兼容"
sidebar_position: 9
description: "建立从数据库 DDL 到消息 Schema、Registry 兼容检查和消费者发布的完整治理流程。"
tags: [Debezium, Schema Evolution, Avro, Protobuf, Schema Registry]
---

# Debezium DDL、Schema Evolution、Avro、Protobuf 与 Schema Registry

DDL 不是数据库团队的局部变更。它会改变 Debezium History、事件 Schema、序列化制品和消费者代码。生产治理应把一次 DDL 当作跨系统版本发布。

## 1. Schema 传播路径

```text
ALTER TABLE
→ DDL进入事务日志
→ Debezium更新Schema History
→ Source Record使用新Schema
→ Converter注册/查找Schema ID
→ Kafka消息携带ID与Payload
→ Consumer按ID获取Schema并反序列化
```

Schema History 用于连接器恢复和解析日志；Schema Registry 用于生产者、消费者共享消息契约。二者用途不同，不能相互替代。

## 2. 常见变更风险

| 变更 | 主要风险 | 安全做法 |
| --- | --- | --- |
| 新增可空/有默认值字段 | 旧消费者未知字段 | 先验证兼容，再发布生产者 |
| 删除/改名字段 | 旧消费者仍读取 | 先双写新字段，再迁移消费者 |
| 改字段类型 | 精度、编码或反序列化失败 | 新字段迁移，避免原位强改 |
| 改主键 | Kafka Key 和分区变化 | 设计旧 Key 删除与新 Key 建立 |
| DECIMAL/时间语义改变 | 精度与时区错误 | 固定 Converter 策略并做样例测试 |

兼容模式要结合读写双方理解：Backward 是新消费者读旧数据，Forward 是旧消费者读新数据，Full 同时满足两者。还要明确检查单个版本还是所有历史版本。

## 3. 发布流程

1. 在代码仓库提交 DDL、预期消息 Schema 和兼容性结果；
2. 用历史 Schema 做 Registry 兼容检查；
3. 先部署能同时读取新旧结构的消费者；
4. 执行 DDL，观察 History Topic 和注册的新版本；
5. 验证 Snapshot、Streaming、DLQ 与关键业务字段；
6. 完成数据回填后再删除旧字段。

## 4. Avro、Protobuf 与 JSON Schema

Avro 适合 Kafka 数据平台和强 Schema 演进；Protobuf 有稳定字段编号，删除字段时要保留编号；JSON Schema 可读性好，但仍要处理默认值、联合类型和兼容规则。选择不是只看编码大小，还要看语言生态、治理能力和历史数据读取。

## 5. 排障

反序列化失败时先取得消息中的 Schema ID，再查 Registry Subject/Version，比较 Writer Schema 与 Reader Schema；随后检查 Debezium Converter 配置和 DDL History。不要先删 Schema 或 Topic，这会把可诊断问题扩大成数据恢复问题。

参考：[Debezium Schema Change Topics](https://debezium.io/documentation/reference/stable/connectors/mysql.html#mysql-schema-change-topic)、[Schema Registry Fundamentals](https://docs.confluent.io/platform/current/schema-registry/fundamentals/index.html)。
