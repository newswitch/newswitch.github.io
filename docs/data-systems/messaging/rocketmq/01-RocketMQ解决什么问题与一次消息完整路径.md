---
title: "RocketMQ 解决什么问题与一次消息完整路径"
sidebar_label: "01. RocketMQ 解决什么问题与一次消息完整路径"
sidebar_position: 1
description: "沿 Producer、NameServer、Broker、CommitLog、ConsumeQueue、复制和消费重试，拆解 RocketMQ 一条消息的完整路径。"
tags: [RocketMQ, 消息队列, CommitLog, Producer, Consumer]
---

# RocketMQ 解决什么问题与一次消息完整路径

RocketMQ 用消息把“业务事务何时完成”和“下游何时处理”解耦，并提供顺序、延时、事务消息、消费重试和可观测路由等能力。它不能自动让分布式业务恰好执行一次；可靠性来自发送确认、存储复制、消费确认、幂等和业务补偿共同组成的闭环。

## 1. 它在架构中的角色

```text
Order Service
  → local transaction / outbox
  → RocketMQ Topic
      ├─ Inventory Consumer Group
      ├─ Notification Consumer Group
      └─ Search Projection Consumer Group
```

Topic 表示一类消息，MessageQueue 是并行与顺序的基本队列单元，Consumer Group 表示一份独立消费进度。两个不同 Group 通常各自收到消息；同一 Group 内多个消费者共同分摊队列。

RocketMQ 适合业务事件、异步任务、削峰、延时与事务消息。若目标是长周期事件流、流计算生态和按分区日志重放，要与 Kafka 比较；若只是进程内短任务，先判断是否真的需要分布式消息系统。

## 2. 组件职责

```text
NameServer：轻量路由注册与发现
Broker：消息写入、存储、查询、投递与消费进度
Producer：发现路由、选择 MessageQueue、发送和重试
Consumer：订阅、拉取/接收、处理和提交结果
Controller（特定 HA 形态）：Broker 副本选主与故障转移
Proxy（5.x 形态）：面向多语言客户端的接入与协议代理
```

NameServer 不保存业务消息，也不是 Broker 数据复制的共识节点。Producer/Consumer 会缓存路由，因此 NameServer 短暂异常不必然让已有链路立即停止，但新路由与变更传播会受影响。

## 3. 一次普通消息发送

```text
Producer
→ serialize topic / key / tag / properties / body
→ query or use cached topic route
→ select target MessageQueue
→ connect to Broker or Proxy
→ Broker validation and ACL
→ append message to CommitLog
→ update dispatch position
→ flush policy / replica acknowledgement policy
→ send result to Producer
```

消息主体按顺序进入 CommitLog；ConsumeQueue 等结构为按 Topic/Queue 消费提供逻辑索引，IndexFile 可支持按 Key 查询。这样避免为每个 Topic 单独维护一套完整消息文件，同时让消费读取能定位到 CommitLog 物理位置。

Producer 收到成功时，必须结合 Broker 刷盘和复制配置解释 RPO。写入进程内存、进入操作系统 Page Cache、完成磁盘同步、复制到从副本，是不同时间点。异步发送还需要应用处理 callback 失败，不能“调用方法没有抛异常”就认为消息一定可靠。

## 4. Producer 重试为什么会重复

典型不确定窗口：

```text
Broker has stored message
→ response is lost or times out
→ Producer cannot know result
→ Producer retries
→ duplicate may be stored
```

因此消息应带稳定业务 Key，消费端按业务唯一约束、状态机或幂等记录处理。不要用随机新 ID 掩盖同一业务事件，也不要把“客户端重试次数”当成端到端 exactly-once。

本地事务与消息发送之间还存在双写问题。可选方案包括 Outbox/CDC 或 RocketMQ 事务消息；二者都需要处理回查、超时、重复、最终失败和人工补偿。

## 5. 一次消费路径

```text
Consumer Group
→ subscribe Topic + Tag/SQL filter
→ obtain route and queue assignment
→ pull/receive messages from Broker
→ Broker locates ConsumeQueue offset
→ read CommitLog body
→ deliver batch to client
→ application processes business transaction
→ report success / failure
→ advance offset or enter retry path
```

消费成功最重要的顺序是：先完成可幂等的业务处理，再确认消费结果。若先确认再写数据库，进程崩溃会造成业务丢失；若先写数据库后确认丢失，消息会重投，所以业务处理必须抗重复。

失败消息通常进入重试机制，超过阈值后进入死信队列。死信不是垃圾桶：必须有告警、可检索业务 Key、根因分类、修复后重放和审计流程。

## 6. 顺序的真实范围

消息系统很少承诺整个 Topic 的无限全局顺序。常见做法是将同一订单/账户的事件用稳定 sharding key 路由到同一 MessageQueue，再保证该队列的发送与消费顺序。

即使如此，还要处理：

- Producer 多线程发送造成先后关系不明确；
- 重试把旧事件放到新事件之后；
- 消费失败暂停或跳过的策略；
- 扩缩容和队列分配变化；
- 下游业务数据库自己的并发提交顺序。

最稳妥的方法是让事件携带业务版本号，在消费者状态机拒绝倒序更新。

## 7. 延迟从哪里来

端到端延迟可拆成：

```text
producer queue/wait
+ network
+ broker append/flush/replication
+ message waiting in queue
+ broker read
+ consumer fetch queue
+ business processing
+ retry/backoff
```

Broker CPU 不高但消费延迟很大，常见原因是消息本就在积压、消费线程受下游数据库限制、某个 MessageQueue 热点、重平衡或重试阻塞。必须同时看生产速率、消费速率、最大/最小 offset、lag 年龄、失败率和业务处理分位数。

## 8. 最小实验

在隔离环境建立一个 Topic、一个 Producer 和两个 Consumer Group：

1. 每条消息写入稳定 Key 和递增业务版本；
2. 证明两个 Group 各自消费，同一 Group 内实例分摊队列；
3. 故意让一次业务处理在提交后返回失败，观察重复投递并验证幂等；
4. 暂停消费者制造积压，再恢复并测量追平速率；
5. 记录发送成功、CommitLog、消费 offset、重试与死信证据；
6. 只在实验环境测试 Broker/网络故障，并验证消息缺口而非只看进程恢复。

## 9. 验收问题

- NameServer、Broker、Controller 与 Proxy 分别负责什么？
- Producer 收到超时时，为什么不能确定消息未写入？
- CommitLog 与 ConsumeQueue 的关系是什么？
- 消费端为什么必须幂等，什么时候才确认成功？
- 顺序通常在哪个范围成立，业务版本号解决什么？
- Lag 大而 Broker CPU 低，应从哪几段时间定位？

## 10. 参考资料

- [RocketMQ 领域模型](https://rocketmq.apache.org/docs/domainModel/01main/)
- [RocketMQ 架构](https://rocketmq.apache.org/docs/introduction/03terms/)
- [RocketMQ 消息存储](https://rocketmq.apache.org/docs/bestPractice/07dataPersistence/)
- [RocketMQ 消费重试](https://rocketmq.apache.org/docs/featureBehavior/10consumerretrypolicy/)
