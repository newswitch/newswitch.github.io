---
title: "用户、Virtual Host、Permission、TLS 与多租户隔离"
sidebar_label: "09. 身份、权限、TLS 与隔离"
sidebar_position: 9
description: "建立 RabbitMQ 身份认证、资源授权、Virtual Host 隔离、TLS 和凭据轮换的生产安全模型。"
tags: [RabbitMQ, TLS, Permission, Virtual Host, 安全]
---

# 用户、Virtual Host、Permission、TLS 与多租户隔离

Virtual Host 是逻辑命名和授权边界，不是强资源隔离或独立集群。一个租户制造高基数队列、海量连接或磁盘耗尽，仍会影响同一 RabbitMQ 集群中的其他租户。

## 1. 认证与授权路径

```text
Client
→ TLS验证Broker身份，可选mTLS验证Client
→ 用户/外部身份认证
→ 进入指定Virtual Host
→ configure/write/read正则授权
→ Topic Permission等细粒度检查
```

三个基础权限分别控制声明/删除资源、向 Exchange 发布、从 Queue 消费。权限正则应按应用前缀设计，避免生产账号获得 `.*`。

## 2. 最小权限示例

假设订单服务只允许声明自己的临时资源、向订单 Exchange 发布并消费自己的队列：

```bash
rabbitmqctl add_vhost orders-prod
rabbitmqctl add_user order-app '通过Secret管理的强密码'
rabbitmqctl set_permissions -p orders-prod order-app \
  '^order-app\.' '^orders\.events$' '^order-app\.'
```

命令中的密码不应进入 Shell 历史或 CI 日志，生产环境优先通过 Secret 文件、外部身份后端或受控自动化注入。

## 3. TLS 设计

- AMQP 与 Management API 分开评估 TLS；
- 客户端校验 CA 和主机名，不设置“跳过验证”；
- 私钥只对 RabbitMQ 进程可读；
- 证书 SAN 覆盖 LB 和节点连接方式；
- 轮换前允许新旧 CA 重叠信任；
- 验证 Erlang 节点间通信是否也需要加密。

## 4. 多租户容量边界

为每个租户限制连接、Channel、Queue、消息大小和资源用量，统一命名与标签。高安全、高噪声或不同合规级别租户应使用独立集群，而不是只分 VHost。

审计至少覆盖用户、权限、Policy、Binding、Queue 删除、认证失败、Management API 操作和证书变更。内置 `guest` 用户不得作为远程生产账号。

## 5. 密钥轮换流程

1. 创建新凭据并赋予同等最小权限；
2. 灰度客户端使用新凭据；
3. 观察认证失败和连接数；
4. 全量切换后撤销旧凭据；
5. 验证旧凭据确实失效；
6. 保存变更审计和回滚窗口。

## 6. 排障

| 现象 | 检查 |
| --- | --- |
| TLS 握手失败 | CA、SAN、时间、协议/密码套件、SNI |
| 能连接不能声明 | configure 权限和资源名 |
| 能发布但消息不达 | write 权限、Exchange/Binding、VHost |
| 能看管理页不能消费 | Management Tag 不等于 Queue read 权限 |
| 某租户拖慢全集群 | 连接/队列/磁盘/内存配额与物理隔离 |

参考：[RabbitMQ Access Control](https://www.rabbitmq.com/docs/access-control)、[TLS](https://www.rabbitmq.com/docs/ssl)。
