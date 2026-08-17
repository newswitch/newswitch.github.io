---
title: "FIFO 顺序消息、锁、Queue 与扩缩容"
sidebar_position: 7
tags: [RocketMQ, FIFO, Ordered Message]
description: "理解 RocketMQ 局部顺序、sharding key、Queue 锁、失败阻塞和扩缩容。"
---

# FIFO 顺序消息、锁、Queue 与扩缩容

顺序通常只对同一 MessageGroup/Sharding Key 映射的 Queue 成立，不是整个 Topic 全局顺序。

```text
order_id → stable hash → one MessageQueue
→ ordered consumption for that group
```

## Producer 顺序

同业务键事件的产生/发送需要明确先后。多线程、重试和多个 Producer 可能让发送到达顺序变化；携带业务 version，让消费者拒绝倒序状态转移。

## Consumer 顺序

SDK 对 Queue/MessageGroup 加锁或串行处理。某消息失败可能阻塞后续消息，可靠顺序与可用性存在取舍。设置处理超时、重试和毒消息隔离，不能无限卡住整个 Queue。

## 扩缩容

增加 Queue 改变新消息 hash 映射，同一 key 可能从旧 Queue 切到新 Queue，与旧积压交叉。扩容需版本化路由、等待旧 Queue 清空或由业务版本收敛。增加 Consumer 超过 Queue 数没有并行收益。

## 全局顺序

单 Queue 可近似全局顺序，但吞吐、可用和故障恢复受单点并行限制。多数业务只需按订单/账户局部顺序。

## 验收题

- FIFO 的顺序范围是什么？
- 为什么仍需业务版本号？
- 毒消息如何影响后续顺序消息？
- 增加 Queue 为什么可能改变同 key 路由？

## 参考资料

- [FIFO messages](https://rocketmq.apache.org/docs/featureBehavior/03fifomessage/)
