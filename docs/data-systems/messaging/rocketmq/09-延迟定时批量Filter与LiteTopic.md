---
title: "延迟/定时消息、批量、Filter 与 LiteTopic"
sidebar_position: 9
tags: [RocketMQ, Delay Message, Timer, Filter, LiteTopic]
description: "理解 RocketMQ 特殊消息能力、时间精度、过滤、批量与版本边界。"
---

# 延迟/定时消息、批量、Filter 与 LiteTopic

## 延迟/定时

消息在指定延迟/时间后变为可消费。它适合超时检查、延后任务，不是硬实时调度：Broker 时钟、存储/扫描、积压和消费端都会引入延迟。

业务设计保存期望执行时间和幂等 ID；消费者处理时再次判断状态，避免订单已支付仍执行关闭。监控计划时间与实际投递/完成的偏差。

## 批量

批量提高吞吐但受总大小、同 Topic/属性约束和失败范围影响。按字节/时间 flush，超大 payload 放对象存储并发送不可变引用/校验和。

## Filter

Tag Filter 简单高效；SQL 属性过滤更灵活但增加 Broker 计算并依赖版本/配置。过滤是订阅语义的一部分，同 Group 内保持一致；敏感 ACL 不能只靠客户端 Filter。

## LiteTopic/新能力

RocketMQ 5.5 等版本能力和名称会演进。采用 LiteTopic/新特性前固定 5.5.x 补丁，核对 Broker、Proxy、SDK、Dashboard 和运维工具支持，跑兼容/升级/回滚实验；不要把 release note 当成熟度证明。

## 验收题

- 定时消息为何不能保证毫秒硬实时？
- 消费时为何还需检查业务状态？
- SQL Filter 的成本在哪里？
- 新 Topic 能力上线为何需全链路版本矩阵？

## 参考资料

- [Delay messages](https://rocketmq.apache.org/docs/featureBehavior/02delaymessage/)
- [RocketMQ releases](https://rocketmq.apache.org/release-notes/)
