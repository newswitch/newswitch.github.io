---
title: "Prometheus、Management API、日志、告警与 SLO"
sidebar_label: "11. 监控、日志、告警与 SLO"
sidebar_position: 11
description: "建立 RabbitMQ 从客户端到队列、副本和节点的分层观测体系，设计面向用户影响的告警。"
tags: [RabbitMQ, Prometheus, Management API, SLO, 可观测性]
---

# Prometheus、Management API、日志、告警与 SLO

RabbitMQ 监控不能只看节点 Up。真正要回答的是：发布是否被确认、消息是否及时被消费、关键队列是否有多数派，以及资源是否足以撑过恢复窗口。

## 1. 分层信号

```text
业务层：消息端到端时延、成功率、重复率
客户端：连接、Channel、Confirm/NACK、重连、消费错误
队列层：Ready、Unacked、最老消息、Publish/Deliver/Ack/Redeliver
副本层：Leader、在线成员、Quorum、同步状态
节点层：内存/磁盘告警、FD、CPU、网络、Erlang进程
```

Management UI 适合人工查看，Prometheus 适合持续采集与告警，HTTP API 适合自动盘点和 Runbook。高频逐队列指标可能产生高基数，应只对关键队列保留细粒度数据。

## 2. SLI 与告警

推荐 SLI：

- 发布 Confirm 成功率和 P99；
- 业务创建到消费完成的端到端年龄；
- 关键消息在截止时间内完成比例；
- 关键 Quorum Queue 有可用多数派比例；
- 重投递和毒消息率。

告警优先看趋势和持续时间。例如 Ready 增长本身不一定异常，`最老消息年龄 > 业务截止时间` 更接近用户影响。磁盘剩余空间应结合当前消耗斜率和预计恢复时间告警。

## 3. 日志关联

统一记录节点名、VHost、Connection/Channel、Queue、业务消息 ID 和错误类别。客户端日志与 Broker 日志必须时间同步。发生连接重置时，沿以下顺序关联：客户端异常时间 → LB/网络 → Broker 连接日志 → 节点资源告警 → 队列 Leader 变化。

## 4. 常用查询方向

```bash
rabbitmq-diagnostics status
rabbitmq-diagnostics alarms
rabbitmq-diagnostics cluster_status
rabbitmqctl list_queues -p / name type messages_ready messages_unacknowledged consumers
```

HTTP API 采集要使用只读账号、TLS 和速率限制，不要让自动化频繁拉取全部队列详情拖慢 Management 插件。

## 5. 告警降噪

- 节点不可用时抑制该节点派生的连接告警；
- 集群失去多数派是高优先级，单副本短暂 Catch-up 可低一级；
- 消费者为零只有在 Ready > 0 且业务应运行时告警；
- 维护窗口使用有截止时间的 Silence；
- 告警注释包含影响、证据、Runbook 和回滚入口。

## 6. 仪表板验收

从一张集群总览下钻到 VHost、Queue、节点和客户端。主动停止消费者、填充磁盘到测试水位、切换 Leader，证明告警能在 SLO 窗口内触发、路由和恢复，而不是只验证图表有数据。

参考：[RabbitMQ Prometheus Monitoring](https://www.rabbitmq.com/docs/prometheus)、[HTTP API](https://www.rabbitmq.com/docs/http-api-reference)。
