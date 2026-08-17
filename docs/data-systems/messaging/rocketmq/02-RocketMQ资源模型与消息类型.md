---
title: "Topic、MessageQueue、Tag、Key、Group 与消息类型"
sidebar_label: "02. Topic、MessageQueue、Tag、Key、Group 与消息类型"
sidebar_position: 2
tags: [RocketMQ, Topic, MessageQueue, Group]
description: "掌握 RocketMQ 资源模型、路由、过滤和消息类型边界。"
---

# Topic、MessageQueue、Tag、Key、Group 与消息类型

```text
Topic → MessageQueues on Brokers
Producer Group → producers
Consumer Group → independent subscription progress
Message → body + key + tag + properties + type
```

Topic 是业务事件类别，MessageQueue 是并行和局部顺序单元。同一 Consumer Group 内实例分摊 Queue，不同 Group 各自消费一份。

## Key/Tag

Key 应使用稳定业务 ID，便于查询、幂等和审计；Tag 是轻量分类并可在 Broker 侧过滤。不要将高维动态条件全部塞进 Tag/属性，复杂筛选应评估 SQL Filter 和成本。

## 消息类型

普通、FIFO、Delay/Timer、Transaction 等需按 Topic/版本的约束创建和使用。不同类型的发送/消费语义、保留和重试可能不同，不能在同一 Topic 随意混用。

## Group 治理

Group 表示业务消费语义，命名含环境/应用/用途；订阅表达式在同一 Group 内应一致，否则实例收到的集合可能异常。广播模式不共享集群消费进度，运维/重置语义不同。

## 容量

Queue 数决定最大消费并行度和 Broker 元数据/文件开销。先按目标并发、顺序 key 分布和 Broker 数规划，增加 Queue 后旧消息不会自动重新分片。

## 验收题

- Topic 与 MessageQueue 的关系是什么？
- 两个 Consumer Group 会怎样消费同一消息？
- Key 与 Tag 分别用于什么？
- Queue 增加为何不自动改变旧消息顺序？

## 参考资料

- [RocketMQ domain model](https://rocketmq.apache.org/docs/domainModel/01main/)
- [Message types](https://rocketmq.apache.org/docs/featureBehavior/01messageType/)
