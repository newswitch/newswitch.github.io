---
title: "事务消息、Half Message、回查与业务幂等"
sidebar_position: 8
tags: [RocketMQ, Transaction Message, Idempotency]
description: "理解 RocketMQ 事务消息 Half、提交/回滚、状态回查和最终一致性边界。"
---

# 事务消息、Half Message、回查与业务幂等

事务消息用于协调本地事务与消息可见性：

```text
Producer sends half message
→ Broker stores but not visible to consumer
→ execute local transaction
→ COMMIT or ROLLBACK message
→ if Broker uncertain, transaction check callback
→ commit makes message consumable
```

它不是分布式 ACID。Broker 无法直接知道本地数据库是否提交，回查必须根据持久业务事务记录返回确定状态。

## 本地事务表

保存 event_id、business_key、state、message state/version。回查只读权威数据库，不依赖进程内变量。UNKNOWN 可短暂返回，超过次数/时间需告警和补偿。

## 不确定窗口

- Half 成功、应用崩溃前本地事务：回查决定；
- 本地事务提交、commit 指令丢失：回查应返回 COMMIT；
- 回查重复/并发：查询幂等；
- 消费重复：消费者仍需幂等。

## 与 Outbox

Outbox 把业务和事件记录放一个 DB 事务，再由 relay/CDC 发送，易审计重放；事务消息由 Broker 主动回查。按数据库/中间件、吞吐、运维和恢复选择。

## 验收题

- Half Message 为什么消费者不可见？
- 回查依据应存在哪里？
- 事务消息为何仍会重复消费？
- Outbox 与事务消息的权威状态分别在哪里？

## 参考资料

- [Transaction messages](https://rocketmq.apache.org/docs/featureBehavior/04transactionmessage/)
