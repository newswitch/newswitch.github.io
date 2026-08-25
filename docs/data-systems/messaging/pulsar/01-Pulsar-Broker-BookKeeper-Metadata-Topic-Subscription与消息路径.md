---
title: "Pulsar Broker、BookKeeper、Metadata、Topic、Subscription 与消息路径"
sidebar_label: "01. 架构与消息路径"
sidebar_position: 1
description: "跟踪生产、持久化、确认、消费和重投递，理解 Pulsar 的计算存储分离架构。"
tags: [Pulsar, Broker, BookKeeper, Subscription]
---

# Pulsar Broker、BookKeeper、Metadata、Topic、Subscription 与消息路径

## 1. 组件职责

| 组件 | 职责 |
| --- | --- |
| Broker | 协议连接、Topic Ownership、分发、复制协调 |
| Bookie | 追加写 Entry，持久化 Ledger Fragment |
| Metadata Store | 集群元数据、Ownership、Ledger 元数据 |
| Proxy | 可选统一入口，不保存消息 |
| Functions/IO | 流处理和 Connector 生态 |

## 2. 写入路径

```text
Producer查找Topic Owner
→ 连接Owner Broker
→ Broker追加Entry到Managed Ledger
→ BookKeeper把Entry并行写入Ensemble
→ 达到Ack Quorum
→ Broker确认Producer
```

BookKeeper 的 Ensemble Size、Write Quorum、Ack Quorum 决定副本与确认边界。比如 E=3、W=3、A=2 表示写三个 Bookie、两个确认即可返回；具体容灾能力还取决于机架感知和故障分布。

## 3. Ledger 与 Topic

Topic 的消息由多个 Ledger 串联保存；Ledger 只追加，关闭后不可再写。Bookie 故障或滚动条件触发新的 Fragment/Ledger。Broker 不持有唯一消息副本，所以 Broker 迁移 Ownership 后可从元数据继续服务。

## 4. 消费与订阅

Subscription Cursor 记录该订阅确认到哪里，同一 Topic 的多个 Subscription 各自消费完整消息流。Shared 提供并行但不保证全局顺序；Key_Shared 让同 Key 保持单消费者处理；Failover 在主消费者失败后切备用。

Ack 可累计或单条；失败消息通过 Ack Timeout、Negative Ack 或消费者断开触发重投递。端到端仍应按至少一次设计幂等。

## 5. 保留与积压

未确认消息形成 Backlog；Retention 决定已确认消息是否仍保留；TTL 可让过期消息被跳过；Backlog Quota 决定积压到阈值时阻止 Producer 或丢弃。四者语义不同。

## 6. 观测

按 Namespace/Topic 观察 Publish/Dispatch Rate、Storage Size、Backlog、Unacked、Redelivery、Bookie 写延迟和 Ledger 创建。Broker CPU 低而延迟高时，应继续检查 Bookie 磁盘、Quorum 尾延迟和 Metadata Store。

参考：[Pulsar Messaging](https://pulsar.apache.org/docs/next/concepts-messaging/)、[BookKeeper Concepts](https://bookkeeper.apache.org/docs/latest/getting-started/concepts/)。
