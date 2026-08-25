---
title: "Classic Queue、Quorum Queue、Stream 与 Super Stream"
sidebar_label: "06. Queue、Quorum 与 Stream 选型"
sidebar_position: 6
description: "比较 RabbitMQ 队列类型的数据模型、复制、安全、延迟和重放能力，给出生产选型方法。"
tags: [RabbitMQ, Classic Queue, Quorum Queue, Stream, Super Stream]
---

# Classic Queue、Quorum Queue、Stream 与 Super Stream

这些类型不是同一条性能曲线上的不同档位，而是面向不同消费模型。先确定“消息确认后是否删除”和“是否需要按 Offset 重放”，再谈吞吐。

## 1. 模型对比

| 类型 | 核心语义 | 副本与故障 | 适合场景 |
| --- | --- | --- | --- |
| Classic Queue | 破坏式消费，ACK 后删除 | 通常单副本 | 临时、低关键度、低延迟工作队列 |
| Quorum Queue | Raft 复制的持久工作队列 | 多数派提交 | 关键业务消息、至少一次投递 |
| Stream | 追加日志，消费者按 Offset 读取 | 多副本、按保留策略删除 | 大积压、重放、扇出、吞吐 |
| Super Stream | 多个分区 Stream 的逻辑组合 | 每分区独立 | 需要水平扩展的事件流 |

Quorum Queue 发布 Confirm 要等待多数副本达到安全条件，因此延迟至少包含副本 RTT 和存储成本。失去多数派时选择停止写入，而不是在两个分区都继续接收造成分叉。

## 2. 工作队列与事件日志

```text
Queue:  message → consumer → ACK → 删除
Stream: record 0,1,2,... → consumer offset → 保留窗口内可重复读取
```

需要“每个任务只由一个消费者组成员处理”时选择队列；需要多个订阅方独立重放历史时选择 Stream。把数千万积压长期压在 Quorum Queue 中，通常不如 Stream 合适。

## 3. 选择副本数

三个投票副本可以容忍一个副本故障，五个可以容忍两个，但增加副本会增加写放大、磁盘与网络成本。偶数副本不会增加可容忍故障数。副本应跨独立节点/故障域，但跨高延迟地域会把 WAN RTT 带入 Confirm 路径。

## 4. 迁移边界

队列类型不是可随意在线修改的普通参数。迁移通常需要：

1. 创建新类型目标队列；
2. 双写或使用受控 Shovel/Federation；
3. 等待旧队列排空或校验 Offset；
4. 切换消费者；
5. 保留回滚窗口后删除旧资源。

不要只比较 `messages/s`。压测应包含 Confirm、持久消息、真实消息大小、消费者 ACK、节点故障和恢复后的 Catch-up。

## 5. 决策问题

- 消费成功后是否还要重放？
- 单队列最大积压和保留时间是多少？
- 是否需要大量消费者独立读取？
- 故障时更重视可用还是一致数据？
- 可接受的 P99 Confirm 延迟是多少？
- 是否存在顺序分区键？

## 6. 验收实验

分别建立 Classic、三副本 Quorum Queue 和 Stream，发布相同数据并记录 Confirm 延迟、磁盘占用和消费方式。停止 Leader 所在节点，观察选主、重投递、Offset 和可用性，再根据业务语义而不是单次吞吐确定选型。

参考：[Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)、[Streams](https://www.rabbitmq.com/docs/streams)。
