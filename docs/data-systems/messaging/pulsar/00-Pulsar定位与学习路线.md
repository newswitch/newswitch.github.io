---
title: "Pulsar 定位与学习路线"
sidebar_label: "00. Pulsar 定位与学习路线"
sidebar_position: 0
description: "理解 Pulsar 计算存储分离、多租户、订阅和跨地域能力，并建立与 Kafka、RocketMQ 的选型框架。"
tags: [Pulsar, Messaging, BookKeeper, Streaming]
---

# Pulsar 定位与学习路线

Apache Pulsar 是分布式消息与流平台。Broker 处理协议、路由和订阅，BookKeeper Bookie 持久化 Ledger，元数据服务保存 Namespace、Bundle、Ledger 等控制状态。计算存储分离使 Broker 更易弹性扩缩。

## 1. 学习路径

1. 本文理解定位、术语与选型；
2. [Broker、BookKeeper、Metadata、Topic、Subscription 与消息路径](./01-Pulsar-Broker-BookKeeper-Metadata-Topic-Subscription与消息路径.md)掌握原理；
3. [部署、分层存储、Geo-Replication、选型与故障 Runbook](./02-Pulsar部署-分层存储-Geo-Replication-选型与故障Runbook.md)掌握生产边界。

## 2. 核心模型

```text
Tenant / Namespace / Topic / Partition
Producer → Broker → Managed Ledger → BookKeeper
Consumer ← Subscription Cursor ← Broker
```

Subscription 有 Exclusive、Failover、Shared、Key_Shared 等模式，决定一个消息可被哪些消费者处理以及顺序范围。

## 3. 选型速览

| 需求 | Pulsar 特点 |
| --- | --- |
| 大量 Topic、租户隔离 | Tenant/Namespace 原生治理 |
| 存储与 Broker 独立扩展 | BookKeeper 分离持久化 |
| 跨地域复制 | Geo-Replication 原生能力 |
| Kafka 生态最成熟 | Kafka 通常更占优势 |
| 简单单集群运维 | Pulsar 组件更多，成本更高 |

## 4. 完成标准

能画出一条消息落到 Ensemble/Quorum 的路径；能解释 Subscription Cursor、Ack、Redelivery 和保留；能分清 Broker、Bookie、Metadata 故障；能根据 Topic 规模、地域、生态和团队能力选择 Pulsar，而不是只比较吞吐数字。

参考：[Pulsar Architecture](https://pulsar.apache.org/docs/next/concepts-architecture-overview/)。
