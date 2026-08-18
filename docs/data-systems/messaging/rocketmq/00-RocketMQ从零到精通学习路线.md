---
title: "RocketMQ 从零到精通学习路线"
sidebar_label: "00. RocketMQ 从零到精通学习路线"
sidebar_position: 0
description: "以 RocketMQ 5.5 为主线，从 Topic、Queue、CommitLog 深入 Producer/Consumer、事务/顺序/延迟消息、Controller 高可用、容量和源码排障。"
tags: [RocketMQ, 消息队列, 事务消息, Controller, 学习路线]
---

# RocketMQ 从零到精通学习路线

RocketMQ 不能只通过“订单场景用事务消息”来学习。需要从 NameServer 路由、Broker、CommitLog、ConsumeQueue、IndexFile、Producer 重试、Consumer Offset、Retry/DLQ、Proxy/gRPC 和 Controller 自动切换建立完整路径。

本路线以 **Apache RocketMQ 5.5.x** 为主线，同时说明 4.x Remoting 客户端、DLedger 与 5.x Proxy/gRPC、Controller 架构的兼容和迁移边界。

## 1. 数据路径

```text
Producer
  → NameServer route lookup / Proxy(gRPC)
  → Broker request
  → CommitLog append
  → ConsumeQueue / IndexFile dispatch
  → replication / ack
  → Consumer assignment / pop or pull
  → business processing
  → ack / offset / retry / DLQ
```

## 2. 课程结构 {/* #2-15-篇文章规划 */}

| 编号 | 文章 | 优先级 | 核心问题 |
| --- | --- | --- | --- |
| Q00 | RocketMQ 从零到精通学习路线 | P0 | 建立消息、存储和控制面地图 |
| Q01 | [RocketMQ 解决什么问题与一次消息完整路径](./01-RocketMQ解决什么问题与一次消息完整路径.md) | P0 | 与 Kafka/RabbitMQ 的边界 |
| Q02 | [Topic、MessageQueue、Tag、Key、Group 与消息类型](./02-RocketMQ资源模型与消息类型.md) | P0 | 资源模型和路由 |
| Q03 | [NameServer、Broker、Proxy、Controller 架构](./03-NameServer-Broker-Proxy-Controller架构.md) | P0 | 发现、数据面和选主职责 |
| Q04 | [CommitLog、ConsumeQueue、IndexFile 与刷盘](./04-CommitLog-ConsumeQueue-IndexFile与刷盘.md) | P0 | 写入、索引、存储和恢复 |
| Q05 | [Producer 同步/异步、重试、批量与可靠发送](./05-Producer同步异步重试批量与可靠发送.md) | P0 | ACK、超时和重复边界 |
| Q06 | [Push/Simple Consumer、Offset、负载均衡与重试 DLQ](./06-Push-Simple-Consumer-Offset重试与DLQ.md) | P0 | 消费进度、重复和积压 |
| Q07 | [FIFO 顺序消息、锁、Queue 与扩缩容](./07-FIFO顺序消息锁Queue与扩缩容.md) | P0 | 局部顺序和可用性代价 |
| Q08 | [事务消息、Half Message、回查与业务幂等](./08-事务消息Half-Message回查与业务幂等.md) | P0 | 本地事务与消息最终一致 |
| Q09 | [延迟/定时消息、批量、Filter 与 LiteTopic](./09-延迟定时批量Filter与LiteTopic.md) | P1 | 特殊消息类型和 5.5 能力 |
| Q10 | [单机、主从、Controller 自动切换、Docker 与 K8s 部署](./10-RocketMQ单机主从Controller-Docker与Kubernetes部署.md) | P0 | 多种拓扑及原理 |
| Q11 | [同步复制、刷盘、SyncStateSet、选主与数据丢失边界](./11-同步复制刷盘SyncStateSet选主与RPO.md) | P1 | 高可用不等于零 RPO |
| Q12 | [Topic/Queue、吞吐、存储、网络与容量规划](./12-Topic-Queue吞吐存储网络与容量规划.md) | P1 | 如何估算 Broker 和保留空间 |
| Q13 | [ACL、TLS、监控、Dashboard、升级与跨集群迁移](./13-ACL-TLS监控Dashboard升级与跨集群迁移.md) | P1 | 安全运维闭环 |
| Q14 | [源码请求路径、积压、发送失败、主从异常与故障 Runbook](./14-源码请求路径与生产故障Runbook.md) | P2 | 从客户端到 CommitLog 定位 |

> 版本基线：本路线以 Apache RocketMQ 5.5.x 为主线，并区分 4.x/5.x 的资源模型、请求路径和部署差异。实验应固定实际运行的 Broker、Proxy、SDK 与管理工具版本。

## 3. 学习重点

### 3.1 业务语义 {/* #业务语义 */}

- 普通消息：至少一次传递下的消费者幂等；
- FIFO：同一 MessageGroup/Queue 内顺序，不代表全局顺序；
- 事务消息：Broker 不会替业务数据库自动提交或回滚；
- 延迟消息：调度精度、存储和过期必须验证；
- Retry/DLQ：是失败治理机制，不是无限重试理由。

### 3.2 高可用 {/* #高可用 */}

Controller 可以自动选择 Broker Master；为了让 Controller 自身容错，需要三副本或更多 Raft 多数派。`enableElectUncleanMaster` 若允许从 SyncStateSet 外选主，可能以消息丢失换可用性，不能只看切换速度。

### 3.3 5.x 客户端 {/* #5x-客户端 */}

5.x 引入标准化 gRPC SDK，通常通过 Proxy 接入；4.x Remoting 客户端与 5.x SDK 在协议、Consumer 模型和能力上有差异，文章会分别给出兼容矩阵。

## 4. P0 验收题

- CommitLog 与 ConsumeQueue 分别保存什么，后者损坏能否重建？
- NameServer 无状态是否代表可以只部署一台？
- Producer 超时后消息到底有没有写入，业务如何处理不确定结果？
- 消费失败进入 Retry Topic 的次数、延迟和 DLQ 怎样治理？
- 事务消息回查为什么要求本地事务状态可查询且幂等？
- Controller 存活、Broker 主从同步和客户端路由是三种什么状态？
- `enableElectUncleanMaster` 对 RPO 有什么影响？
- Broker 磁盘利用率不高，为什么积压仍可能拖垮发送延迟？

## 5. 实验拓扑

```text
单机：消息类型、CommitLog、消费和重试
双主/多 Broker：Topic Queue 分布和吞吐
主从 + 3 Controller：同步、选主、fencing 和恢复
Proxy + gRPC：多语言客户端和接入
业务数据库：事务消息、Outbox、幂等和补偿
```

## 6. 官方资料

- [Apache RocketMQ Documentation](https://rocketmq.apache.org/docs/)
- [RocketMQ 5.x Concepts](https://rocketmq.apache.org/docs/introduction/02concepts/)
- [Controller Automatic Failover](https://rocketmq.apache.org/docs/deploymentOperations/03autofailover/)
- [Apache RocketMQ Source](https://github.com/apache/rocketmq)

比较 RocketMQ 与 Kafka 时，应采用相同的可靠性维度：写入确认、复制、消费进度、重试、事务、积压、扩缩和跨集群，不能只对照功能清单。
