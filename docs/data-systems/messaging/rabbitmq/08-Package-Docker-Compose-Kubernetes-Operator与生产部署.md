---
title: "Package、Docker、Compose、Kubernetes Operator 与生产部署"
sidebar_label: "08. 多种部署方式与生产基线"
sidebar_position: 8
description: "从实验到生产比较 RabbitMQ 软件包、容器、Compose 和 Kubernetes Operator 部署及其状态边界。"
tags: [RabbitMQ, Docker, Kubernetes, Operator, 部署]
---

# Package、Docker、Compose、Kubernetes Operator 与生产部署

部署方式改变进程管理、持久卷、网络身份和升级流程，但不会改变 RabbitMQ 对稳定节点名、持久数据、低延迟节点网络和多数派的要求。

## 1. 选择部署形态

| 形态 | 适用范围 | 关键风险 |
| --- | --- | --- |
| Package + systemd | 固定 VM/物理机生产 | 配置漂移、人工升级 |
| Docker | 单节点实验 | 容器删除导致数据丢失 |
| Compose | 本地三节点验证 | 不等于生产编排和故障域 |
| Cluster Operator | Kubernetes 生产 | PVC、调度、终止与滚动策略 |

## 2. systemd 生产基线

规划独立数据盘、日志目录、节点 FQDN、Cookie、管理口和集群通信端口。配置文件纳入版本管理，Secret 单独分发。每个节点设置资源限制和文件描述符，使用 NTP，并通过 LB 暴露 AMQP/TLS，而不是直接依赖单节点地址。

```ini
# rabbitmq.conf 片段，实际值按版本验证
listeners.tcp = none
listeners.ssl.default = 5671
management.tcp.port = 15672
disk_free_limit.relative = 1.5
vm_memory_high_watermark.relative = 0.6
```

## 3. 容器关键点

- `/var/lib/rabbitmq` 必须使用持久卷；
- 节点名和 Cookie 在重建后保持一致；
- 使用明确镜像版本和摘要，不使用漂移的 `latest`；
- Healthcheck 区分进程、应用就绪和本地告警；
- 优雅终止时间覆盖连接迁移和队列 Leader 转移；
- 容器内存限制必须与 RabbitMQ 水位计算一致。

## 4. Kubernetes Operator

Operator 把 Cluster CR 转换为 StatefulSet、Service、Secret、ConfigMap 和 PVC。StatefulSet 序号提供稳定身份，Headless Service 支持节点发现，PodDisruptionBudget 防止维护同时失去多数派。

生产设计必须明确：

1. StorageClass 的性能与扩容能力；
2. Pod Anti-Affinity/Topology Spread 是否跨故障域；
3. 节点驱逐时 PVC 能否在目标区挂载；
4. Operator 与 RabbitMQ 版本兼容；
5. 备份的是声明配置还是消息数据；
6. 升级时每个 Quorum Queue 是否仍有多数派。

## 5. 验收流程

```text
安装 → 创建集群 → 声明关键队列 → TLS客户端连接
→ 发布/消费基线 → 删除一个Pod → 验证选主和重连
→ 节点排水 → 验证PDB → 扩容/升级 → 回滚
```

验收必须记录 Confirm P99、重连时间、消息重复、PVC 挂载时间和副本追平时间。只看到 Pod `Running` 不能证明消息服务已经可用。

参考：[RabbitMQ Deployment Guidelines](https://www.rabbitmq.com/docs/production-checklist)、[Cluster Operator](https://www.rabbitmq.com/kubernetes/operator/operator-overview)。
