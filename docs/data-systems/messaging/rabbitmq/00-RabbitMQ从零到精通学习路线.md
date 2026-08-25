---
title: "RabbitMQ 从零到精通学习路线"
sidebar_label: "00. RabbitMQ 从零到精通学习路线"
sidebar_position: 0
description: "从 AMQP、Exchange、Queue、ACK 和 Publisher Confirm 入门，进阶到 Quorum Queue、集群、容量、安全、升级和故障恢复。"
tags: [RabbitMQ, AMQP, 消息队列, Quorum Queue, 学习路线]
---

# RabbitMQ 从零到精通学习路线

RabbitMQ 不是“把消息放进一个列表”这么简单。生产系统需要同时理解发布路由、消息持久性、消费者确认、流量控制、队列副本和故障恢复，否则很容易出现消息已经返回成功但没有落入队列、消费者内存被打满或节点恢复后消息丢失。

本路线统一使用下面的数据路径：

```text
Producer
→ TCP/TLS Connection
→ AMQP Channel
→ Exchange
→ Binding与Routing Key
→ Queue/Quorum Queue/Stream
→ Consumer Delivery
→ ACK/NACK
```

## 1. P0：消息路径与可靠性

1. [RabbitMQ 解决什么问题与一条消息的完整路径](./01-RabbitMQ解决什么问题与一条消息的完整路径.md)
2. [AMQP、Exchange、Queue、Binding 与 Virtual Host](./02-AMQP-Exchange-Queue-Binding与Virtual-Host.md)
3. [消息持久化、Publisher Confirm 与消费者 ACK](./03-消息持久化-Publisher-Confirm与消费者ACK.md)
4. [Prefetch、并发消费、顺序与重投递](./04-Prefetch-并发消费-顺序与重投递.md)
5. [TTL、死信、重试、延迟消息与毒消息隔离](./05-TTL-死信-重试-延迟消息与毒消息隔离.md)
6. [Classic Queue、Quorum Queue、Stream 与 Super Stream](./06-Classic-Queue-Quorum-Queue-Stream与Super-Stream.md)

完成 P0 后，应能解释：消息什么时候只到达 Broker、什么时候进入队列、什么时候可以认为消费完成，以及每个阶段故障会不会造成丢失或重复。

## 2. P1：部署、集群与生产运维

7. [RabbitMQ 节点、集群元数据、Quorum 与网络分区](./07-RabbitMQ节点-集群元数据-Quorum与网络分区.md)
8. [Package、Docker、Compose、Kubernetes Operator 与生产部署](./08-Package-Docker-Compose-Kubernetes-Operator与生产部署.md)
9. [用户、Virtual Host、Permission、TLS 与多租户隔离](./09-用户-Virtual-Host-Permission-TLS与多租户隔离.md)
10. [内存水位、磁盘水位、流控、容量规划与压测](./10-内存水位-磁盘水位-流控-容量规划与压测.md)
11. [Prometheus、Management API、日志、告警与 SLO](./11-Prometheus-Management-API-日志-告警与SLO.md)
12. [定义备份、消息恢复、滚动升级与跨集群迁移](./12-定义备份-消息恢复-滚动升级与跨集群迁移.md)

## 3. P2：客户端、命令与故障处理

13. [rabbitmqctl、rabbitmq-diagnostics、rabbitmq-queues 与 HTTP API](./13-rabbitmqctl-rabbitmq-diagnostics-rabbitmq-queues与HTTP-API.md)
14. [RabbitMQ 生产故障 Runbook 与故障演练](./14-RabbitMQ生产故障Runbook与故障演练.md)

## 4. RabbitMQ 与相邻系统怎样选

| 场景 | RabbitMQ | Kafka | RocketMQ |
| --- | --- | --- | --- |
| 复杂路由 | Exchange/Binding 能力强 | 通常由 Topic/Partition 和应用完成 | Topic/Tag/SQL 过滤 |
| 工作队列 | 非常适合 | 可以实现但语义偏事件日志 | 适合业务消息 |
| 消费模型 | Broker 推送为主，也支持拉取接口 | Consumer Pull | Push/Pull 客户端封装 |
| 消息保留 | 消费确认后通常删除 | 按时间/空间保留，可重放 | 按保留策略存储 |
| 单条消息 ACK | 原生核心能力 | Offset 提交 | 消费结果/Offset |
| 大规模事件流 | Stream/Super Stream 可覆盖部分场景 | 典型优势 | 典型业务消息场景 |

不是“吞吐最高的产品就最好”。应先明确是否需要复杂路由、任务分发、事件重放、顺序、延迟、事务和海量保留。

## 5. 每篇文章的验证标准

```text
画路径
→ 写最小生产者和消费者
→ 观察Broker状态
→ 主动制造单变量故障
→ 判断丢失、重复和顺序
→ 完成恢复并核对消息
```

至少完成以下实验：

- unroutable 消息与 `mandatory`；
- Publisher Confirm 成功和失败；
- 手动 ACK、NACK、requeue；
- Consumer 断开后的未确认消息重投递；
- Prefetch 过大导致的消费者内存压力；
- Quorum Queue 单节点故障；
- 磁盘水位和内存水位流控；
- TLS、最小权限和跨 Virtual Host 隔离；
- 滚动升级与失败回滚；
- 消息积压、毒消息和磁盘耗尽演练。

## 6. 学习完成标准

- 能画出 Producer 到 Consumer ACK 的完整路径；
- 能解释 Exchange 不存消息、Queue 才是主要消息容器；
- 能区分 durable queue、persistent message 和 confirm；
- 能设计至少一次投递、幂等和毒消息处理；
- 能选择 Classic、Quorum、Stream；
- 能部署三节点集群并验证单节点故障；
- 能根据 ready、unacked、publish、deliver、ack 和磁盘水位定位积压；
- 能安全完成权限、备份、升级和故障恢复。
