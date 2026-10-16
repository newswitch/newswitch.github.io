---
title: "rabbitmqctl、rabbitmq-diagnostics、rabbitmq-queues 与 HTTP API"
sidebar_label: "13. 命令行与 HTTP API"
sidebar_position: 13
description: "按配置管理、健康诊断、队列副本和自动化查询分类掌握 RabbitMQ 管理工具。"
tags: [RabbitMQ, rabbitmqctl, rabbitmq-diagnostics, rabbitmq-queues, HTTP API]
---

# rabbitmqctl、rabbitmq-diagnostics、rabbitmq-queues 与 HTTP API

四类工具职责不同：`rabbitmqctl` 管理对象和运行状态，`rabbitmq-diagnostics` 做健康诊断，`rabbitmq-queues` 处理副本型队列，HTTP API 面向远程查询和自动化。

## 1. 安全使用原则

- 先执行只读命令并保存时间、节点和版本；
- 明确 `-n` 目标节点和 `-p` Virtual Host；
- 生产输出优先选择结构化格式；
- 删除队列、忘记节点、强制恢复、Rebalance 前必须审批；
- HTTP API 使用最小权限账号和 TLS；
- 命令失败先查 Cookie、节点名、DNS 和端口，不要反复重启。

## 2. 常用只读命令

```bash
rabbitmq-diagnostics ping
rabbitmq-diagnostics status
rabbitmq-diagnostics alarms
rabbitmq-diagnostics cluster_status
rabbitmq-diagnostics listeners

rabbitmqctl list_vhosts
rabbitmqctl list_users
rabbitmqctl list_permissions -p /
rabbitmqctl list_connections name user vhost state channels send_pend
rabbitmqctl list_queues -p / name type durable consumers messages_ready messages_unacknowledged

rabbitmq-queues quorum_status --vhost / critical.queue
```

先限制列字段和 VHost，避免在海量队列集群中执行无界详情查询。

## 3. HTTP API

```bash
curl --fail --silent --show-error \
  --user "$RMQ_USER:$RMQ_PASSWORD" \
  https://rabbit.example.com/api/overview
```

不要把密码直接写入脚本或命令历史。自动化应设置连接/读取超时、分页、重试上限和响应大小限制。

典型用途包括盘点队列、检查 Consumers、读取节点告警、导出 Definitions 和构建只读运维门户。API 返回 200 只代表 Management 请求成功，不代表 AMQP 发布链路满足 SLO。

## 4. 从现象选择工具

| 问题 | 首选证据 |
| --- | --- |
| CLI 连不上节点 | `diagnostics ping/status`、节点名、Cookie |
| 发布被阻塞 | `diagnostics alarms`、Connection state |
| 消息积压 | `list_queues` 的 Ready/Unacked/Consumers |
| Quorum 不可用 | `rabbitmq-queues quorum_status`、成员状态 |
| 权限失败 | Users、Permissions、VHost 与 Broker 日志 |
| 自动盘点 | HTTP API，限定字段/分页 |

## 5. 变更前后证据

任何管理动作都记录：原命令、目标、审批、变更前快照、退出码、变更后健康、业务验证和回滚命令。把“命令执行成功”与“业务恢复”分开验收。

参考：[RabbitMQ CLI Tools](https://www.rabbitmq.com/docs/cli)、[HTTP API Reference](https://www.rabbitmq.com/docs/http-api-reference)。
