---
title: "Producer 同步/异步、重试、批量与可靠发送"
sidebar_position: 5
tags: [RocketMQ, Producer, Retry, Batch]
description: "理解发送模式、路由、超时不确定性、重试重复、批量和可靠 Outbox。"
---

# Producer 同步/异步、重试、批量与可靠发送

```text
business event → serialize/key
→ route select Queue → send to Broker/Proxy
→ append/flush/replicate → receipt
```

同步等待结果，异步通过 callback 完成，oneway 不等待可靠确认。异步必须持久化/处理 callback 失败，进程退出前排空在途请求。

## 超时和重试

Broker 已写入但响应丢失时 Producer 超时，重试会重复。使用稳定业务 event ID/Key，消费者唯一约束或状态机幂等。重试限制次数、总预算和不同 Broker 选择，避免故障风暴。

## Queue 选择

默认负载均衡；顺序消息用 sharding key 保证相同业务键落同 Queue。自定义 selector 必须处理 Queue 数变化和倾斜。

## 批量

批量摊薄网络/协议成本，但受消息总大小、延迟和失败范围限制。按字节/时间双阈值 flush，逐批记录结果；超大消息应外置对象并发送引用。

## 业务一致性

数据库事务与消息发送的双写使用 Outbox/CDC 或事务消息。不能用“数据库 commit 后调用 send”假设进程永不崩溃。

## 验收题

- 超时为什么不能解释为未写入？
- 异步发送如何保证进程退出不丢 callback？
- 批量如何交换吞吐与延迟？
- Outbox 解决哪个双写窗口？

## 参考资料

- [Message sending retry](https://rocketmq.apache.org/docs/featureBehavior/05sendretrypolicy/)
