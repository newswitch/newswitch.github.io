---
title: "Streams、Pub/Sub、可靠队列与 Kafka/RocketMQ 对比"
sidebar_label: "13. Streams、Pub/Sub、可靠队列与 Kafka/RocketMQ 对比"
sidebar_position: 13
tags: [Redis, Streams, PubSub, Kafka, RocketMQ]
description: "理解 Redis Pub/Sub 与 Streams 的投递、消费组、Pending、重放和积压边界。"
---

# Streams、Pub/Sub、可靠队列与 Kafka/RocketMQ 对比

Pub/Sub 是在线广播：订阅者断开期间通常不会保留消息，适合可丢通知。Streams 保存有序 entry，并支持 consumer group、pending 和确认，更接近队列/日志。

## Streams 路径

```text
XADD → stream entry ID
→ XREADGROUP delivers to consumer
→ Pending Entries List
→ business processing
→ XACK
```

消费者崩溃后 entry 留在 Pending，需要 `XPENDING` 发现并由 `XAUTOCLAIM`/恢复流程接管。先 ACK 再完成业务会丢处理；先业务后 ACK 会重复，因此消费者必须幂等。

## 保留与积压

`MAXLEN` 近似/精确修剪影响内存和重放窗口。要监控 stream length、last-generated-id、group lag、pending 数量/年龄和消费者空闲。无界 Stream 会耗尽内存，过度修剪会删除尚需审计的数据。

## 与专业消息系统比较

| 维度 | Redis Streams | Kafka/RocketMQ |
| --- | --- | --- |
| 运维 | 已有 Redis 时简单 | 独立集群 |
| 长期大积压 | 内存成本高 | 磁盘日志更合适 |
| 分区/扩展 | Stream/Cluster 需自行设计 | 原生分区/Queue |
| 生态/跨集群 | 较少 | 更完整 |
| 原子数据结构组合 | 强 | 通常需应用协调 |

关键业务、大积压、长保留和跨集群优先评估 Kafka/RocketMQ；轻量短队列可用 Streams。

## 验收题

- Pub/Sub 订阅者离线会怎样？
- Pending 与 ACK 分别代表什么？
- 如何恢复长期 idle consumer 的消息？
- Stream 修剪为什么可能破坏重放？

## 参考资料

- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)
- [Pub/Sub](https://redis.io/docs/latest/develop/pubsub/)
