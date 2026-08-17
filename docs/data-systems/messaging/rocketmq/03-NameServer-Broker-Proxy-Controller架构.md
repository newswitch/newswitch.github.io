---
title: "NameServer、Broker、Proxy、Controller 架构"
sidebar_label: "03. NameServer、Broker、Proxy、Controller 架构"
sidebar_position: 3
tags: [RocketMQ, NameServer, Broker, Proxy, Controller]
description: "区分 RocketMQ 路由、存储、接入与选主组件并追踪配置传播。"
---

# NameServer、Broker、Proxy、Controller 架构

| 组件 | 职责 | 是否保存消息 |
| --- | --- | --- |
| NameServer | Broker/Topic 路由发现 | 否 |
| Broker | 存储、投递、消费进度 | 是 |
| Proxy | gRPC/多语言接入、路由代理 | 否/无状态为主 |
| Controller | Broker 副本主从选举/epoch | 不保存业务消息 |

## 路由

Broker 周期向 NameServer 注册 Topic/Queue 和地址；Producer/Consumer 从多个 NameServer 获取并缓存路由。NameServer 节点彼此可独立，短暂故障时已有缓存仍可用，但路由变化会延迟。

## Broker/Proxy

Broker 处理 Remoting/存储；5.x gRPC SDK 通常经 Proxy。Proxy 可与 Broker 同进程 local mode，也可独立扩展。独立 Proxy 需 LB、TLS/ACL、连接排空和到 NameServer/Broker 的可观测链路。

## Controller

Controller 通过 Raft 多数派管理 Broker replica group 的 Master epoch/SyncStateSet。它可嵌入 NameServer 或独立部署；NameServer 仍负责路由。Controller 不健康可能影响切换，但已有主的正常收发行为需按故障类型验证。

## 证据

路由异常时比对 NameServer 路由、Broker 注册、Proxy 缓存和客户端 endpoint；选主异常查看 Controller quorum、epoch、SyncStateSet 和 Broker 状态。

## 验收题

- NameServer 为什么不是消息副本？
- Proxy 与 Broker local/cluster mode 有何差异？
- Controller 故障是否必然中断已有收发？
- 路由缓存为何能提高可用却导致陈旧？

## 参考资料

- [RocketMQ architecture](https://rocketmq.apache.org/docs/introduction/03terms/)
- [Deployment](https://rocketmq.apache.org/docs/deploymentOperations/01deploy/)
