---
title: "Schema Registry 定位与学习路线"
sidebar_label: "00. Schema Registry 定位与学习路线"
sidebar_position: 0
description: "理解 Schema Registry 如何管理消息契约、版本与兼容性，并掌握它与 Kafka、Debezium 的边界。"
tags: [Schema Registry, Avro, Protobuf, JSON Schema]
---

# Schema Registry 定位与学习路线

Schema Registry 是消息数据契约的集中服务：保存 Schema 版本、分配全局 ID、执行兼容检查，并让 Serializer/Deserializer 通过 ID 交换紧凑数据。它不保存业务消息，也不会自动修复不兼容的消费者。

## 1. 学习路径

1. 本文理解为什么需要 Registry；
2. [Subject、Version、ID、SerDes 与三种 Schema 的消息路径](./01-Subject-Version-ID-SerDes-Avro-Protobuf-JSON-Schema与消息路径.md)掌握数据面；
3. [兼容策略、部署、安全、迁移、选型与故障 Runbook](./02-兼容策略-部署-安全-迁移-选型与故障Runbook.md)掌握治理与运维。

## 2. 解决的问题

没有契约时，生产者删字段或改类型，错误只能在消费者运行时暴露。Registry 将检查前移到 CI/CD，并让历史消息保留 Writer Schema。

```text
代码中的Schema
→ CI兼容检查
→ Producer注册并获得Schema ID
→ 消息携带ID而不是完整Schema
→ Consumer按ID取得Writer Schema
→ 用Reader Schema反序列化
```

## 3. 与其他状态的边界

Debezium Schema History 用于连接器在日志位置上恢复表结构；Registry 用于消息生产者与消费者交换契约；数据库 Catalog 则是当前表结构。三者必须一致治理，但不能互换。

## 4. 完成标准

能区分 Subject、Version 和全局 ID；能解释 Backward/Forward/Full；能设计字段新增、删除、改名和类型迁移；能在 Registry 不可用时判断缓存读、Schema 注册和新实例启动的不同影响；能选择 Avro、Protobuf 或 JSON Schema。

参考：[Schema Registry Fundamentals](https://docs.confluent.io/platform/current/schema-registry/fundamentals/index.html)。
