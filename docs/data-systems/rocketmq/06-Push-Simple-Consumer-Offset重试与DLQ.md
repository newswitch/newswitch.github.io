---
title: "Push/Simple Consumer、Offset、负载均衡与重试 DLQ"
sidebar_position: 6
tags: [RocketMQ, Consumer, Offset, Retry, DLQ]
description: "理解消费模式、Queue 分配、确认、重复、重试和死信治理。"
---

# Push/Simple Consumer、Offset、负载均衡与重试 DLQ

PushConsumer 由 SDK 管理拉取、缓存、线程和回调；SimpleConsumer 让应用显式 receive/ack/invisible duration，更适合需要控制节奏的场景。

```text
Group assignment → fetch Queue offset
→ local process queue → business handler
→ success ACK/offset advance
→ failure retry → DLQ after limit
```

## Offset 与重复

业务提交成功、ACK 丢失会重投；先 ACK 后业务崩溃会丢处理。正确顺序是幂等业务事务后确认。Offset 是 Group/Queue 维度，重置前确认时间、目标 offset、在线状态和回放副作用。

## 负载均衡

同 Group 实例分配 Queue，最大有效并行实例受 Queue 数限制。实例增删会 rebalance，暂停/转移本地队列；长处理需控制单消息时间和优雅停机。

## 重试/DLQ

区分临时依赖、永久脏数据、权限和代码 Bug。重试用退避，避免立即打爆下游。DLQ 必须告警、保留业务 Key/错误、修复后受控重放并审计。

## 积压

Lag 同时看数量和最老消息年龄。定位生产速率、Queue 倾斜、消费线程、GC、下游 DB/API 和 retry；盲目扩 Consumer 在 Queue/下游已满时无效。

## 验收题

- SimpleConsumer 与 PushConsumer 的控制权差异？
- 业务完成后 ACK 丢失会怎样？
- Consumer 实例为何不能无限提升并行？
- DLQ 重放需要哪些安全条件？

## 参考资料

- [Consumer retry](https://rocketmq.apache.org/docs/featureBehavior/10consumerretrypolicy/)
- [SimpleConsumer](https://rocketmq.apache.org/docs/featureBehavior/06consumertype/)
