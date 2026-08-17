---
title: "源码请求路径、积压、发送失败、主从异常与故障 Runbook"
sidebar_position: 14
tags: [RocketMQ, 源码, Runbook]
description: "从客户端、Remoting/Proxy、Broker Processor 到 CommitLog 和复制定位 RocketMQ 故障。"
---

# 源码请求路径、积压、发送失败、主从异常与故障 Runbook

## 源码主路径

固定 release tag：

```text
client send/receive
→ Proxy gRPC or Remoting Netty
→ Broker request processor
→ message store putMessage
→ CommitLog append/flush
→ HA replication
→ reput → ConsumeQueue/Index
→ pull/pop delivery
```

按 request code、msgId、queue offset、commitlog offset 搜源码和日志，不背类行号。

## Runbook

```text
send fail → DNS/endpoint/route → Proxy/Broker queue
          → disk/full/page cache → flush/replica ACK
lag       → Queue distribution → consumer rebalance/process
          → retry/DLQ/downstream → Broker read/disk
replica abnormal → network → offset/SyncStateSet → disk → Controller epoch
route stale → Broker registration → NameServer → Proxy/client cache
```

## 证据和保护

保存 clusterList、topic route、consumer progress、Broker runtime、Controller/SyncStateSet、磁盘和连续业务序号。先限流/停非关键 Producer，避免重试和积压继续扩大。未知情况下不删除 CommitLog、ConsumeQueue、Controller log 或重置 offset。

## 恢复验证

检查已确认消息缺口/重复、各 Group offset、DLQ、Topic Queue 分布和业务最终状态；故障节点重新加入后验证 epoch/角色和追平。

## 验收题

- 发送失败应沿哪几个 Processor/存储阶段？
- Lag 大但 Broker CPU 低可能在哪里？
- 为什么不能随意重置 offset“清积压”？
- 源码排障为何需要 msgId 和物理/逻辑 offset？

## 参考资料

- [RocketMQ source](https://github.com/apache/rocketmq)
- [Troubleshooting](https://rocketmq.apache.org/docs/bestPractice/06FAQ/)
