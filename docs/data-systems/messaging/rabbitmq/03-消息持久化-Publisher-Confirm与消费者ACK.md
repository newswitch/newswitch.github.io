---
title: "消息持久化、Publisher Confirm 与消费者 ACK"
sidebar_label: "03. 持久化、Confirm 与 ACK"
sidebar_position: 3
description: "拆开 durable、persistent、Publisher Confirm 和 Consumer ACK，建立 RabbitMQ 端到端可靠性模型。"
tags: [RabbitMQ, Publisher Confirm, ACK, 持久化, 可靠性]
---

# 消息持久化、Publisher Confirm 与消费者 ACK

RabbitMQ 的“可靠”由多个独立条件组成。只声明持久化队列，不能证明消息已经进入磁盘；只收到 Publisher Confirm，也不能证明业务已经处理完成。

## 1. 四个不同的确认点

```text
Producer --publish--> Broker --route--> Queue --deliver--> Consumer --ack--> Broker
              │                     │                            │
         TCP写成功             Publisher Confirm            Consumer ACK
```

| 机制 | 回答的问题 | 不能证明什么 |
| --- | --- | --- |
| durable Exchange/Queue | Broker 重启后拓扑是否保留 | 单条消息一定保留 |
| persistent message | 消息是否要求持久化 | 已完成副本落盘 |
| Publisher Confirm | Broker 是否接受并按队列类型完成安全条件 | 消费者业务成功 |
| Consumer ACK | 当前 Delivery 是否可以从队列移除 | 下游副作用一定只执行一次 |

生产发布通常要同时使用 durable 拓扑、持久消息、Confirm 和不可路由检测。消费者则使用手动 ACK，并把 ACK 放在数据库事务、对象写入或其他业务副作用成功之后。

## 2. 发布端正确顺序

1. 建立长连接与 Channel；
2. 声明或验证 Exchange、Queue 和 Binding；
3. 开启 Confirm 模式；
4. 发布持久消息，并设置 `mandatory` 或处理返回消息；
5. 按 Delivery Tag 等待异步 Confirm；
6. 超时或 NACK 时进入有界重试，不无限快速重发。

Confirm 与 `mandatory` 解决不同问题：消息无法路由时可能先返回，再收到 Confirm；因此客户端必须分别注册 Return 和 Confirm 处理器。

## 3. 消费端至少一次语义

```text
receive
→ 校验message_id
→ 开启本地事务
→ 写幂等记录与业务状态
→ 提交事务
→ basic.ack
```

如果业务提交后、ACK 前进程退出，消息会重投递，所以消费者必须幂等。常见做法是以业务键或 `message_id` 建唯一约束，而不是依赖内存 Set。

`basic.nack/reject` 的 `requeue=true` 会重新入队；永久错误若一直 requeue 会形成热循环，应转入死信队列。批量 ACK 的 `multiple=true` 会确认当前 Tag 及之前所有未确认消息，乱用会扩大误确认范围。

## 4. 故障边界

| 故障点 | 可能结果 | 应对 |
| --- | --- | --- |
| publish 后连接断开，未收到 Confirm | 成功与否未知 | 使用业务 ID 幂等重试 |
| Classic Queue 节点故障 | 取决于队列类型与数据状态 | 关键数据使用 Quorum Queue |
| 消费者处理成功但未 ACK | 重投递 | 业务幂等 |
| ACK 后下游异步写失败 | RabbitMQ 无法召回消息 | 把关键副作用纳入事务或 Outbox |

## 5. 验证实验

准备一个持久队列和手动 ACK 消费者，依次测试：

1. 发布后立即停止 Broker，核对 Confirm 与重启后的消息；
2. 删除 Binding 后使用 `mandatory` 发布，观察 Return；
3. 消费者完成数据库写入后、ACK 前退出，观察 `redelivered`；
4. 重复处理同一 `message_id`，验证唯一约束没有产生双重副作用。

观察 `messages_ready`、`messages_unacknowledged`、发布 Confirm 延迟和消费者 ACK 速率。只有路径上的每个确认点都被验证，才能描述可靠性，而不能笼统宣称“消息不丢”。

## 6. 生产检查

- 发布端有 Confirm 超时、重试上限和未知状态处理；
- 拓扑声明幂等且参数一致；
- 消费端关闭 Auto ACK；
- 业务副作用幂等，毒消息不会无限重入；
- 关键队列选择合适的副本类型；
- 告警覆盖 NACK、Return、Unacked、Redelivery 和积压。

参考：[RabbitMQ Publisher Confirms](https://www.rabbitmq.com/docs/confirms)。
