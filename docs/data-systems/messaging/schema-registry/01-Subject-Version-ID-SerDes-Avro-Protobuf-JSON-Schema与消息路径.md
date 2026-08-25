---
title: "Schema Registry：Subject、Version、ID、SerDes、Avro、Protobuf 与 JSON Schema"
sidebar_label: "01. 对象模型与消息路径"
sidebar_position: 1
description: "跟踪 Schema 注册、ID 编码和反序列化路径，理解 Subject 命名与 Schema 演进。"
tags: [Schema Registry, SerDes, Avro, Protobuf]
---

# Schema Registry：Subject、Version、ID、SerDes、Avro、Protobuf 与 JSON Schema

## 1. 三个标识

| 概念 | 含义 |
| --- | --- |
| Subject | 一条独立的版本与兼容性演进线 |
| Version | Schema 在 Subject 内的第几个版本 |
| Schema ID | Registry 中内容 Schema 的标识，可被多个 Subject/Version 复用 |

Subject 命名策略可按 Topic Key/Value、Record Name 或 Topic+Record Name。它决定不同 Topic/事件能否独立演进，是架构决策，不只是客户端参数。

## 2. 写入与读取

```text
Producer Serializer
→ 查本地缓存
→ 注册/查找Subject中的Schema
→ 得到Schema ID
→ 写入魔数/格式标记 + ID + 二进制Payload
→ Kafka
→ Consumer读取ID
→ Registry/缓存取得Writer Schema
→ Writer + Reader Schema完成反序列化
```

生产环境通常关闭无治理的自动注册，在 CI 中先检查和注册；应用发布只使用已批准 Schema。Registry 短时故障时，已缓存 ID 的读写可能继续，但新 Schema、冷启动实例和缓存未命中会失败。

## 3. 三种格式

| 格式 | 优势 | 注意 |
| --- | --- | --- |
| Avro | 紧凑、Writer/Reader Schema 演进成熟 | 字段默认值和 Union 要规范 |
| Protobuf | 跨语言、字段编号稳定 | 删除字段要 `reserved` 编号/名称 |
| JSON Schema | 可读、Web 生态熟悉 | 编码通常更大，兼容语义仍需治理 |

Schema 相同不代表业务语义相同。金额从“元”改为“分”即使类型不变也会破坏消费者，需要数据契约文档和语义版本。

## 4. Key 与 Value

Kafka Key Schema 和 Value Schema 通常是不同 Subject。Key 变化会改变分区、Join、Compact 和状态存储，治理级别应高于普通 Value 新增字段。

## 5. 调试

反序列化失败先提取消息 ID，再查询对应 Schema；比较 Writer Schema、Consumer Reader Schema、Subject Strategy 和客户端格式。若 ID 查不到，区分 Registry 数据丢失、访问错误和消息并非该 Wire Format。

参考：[Schema Registry Serializer and Formatter](https://docs.confluent.io/platform/current/schema-registry/serdes-develop/index.html)。
