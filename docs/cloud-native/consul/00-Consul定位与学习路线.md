---
title: "Consul 定位与学习路线"
sidebar_label: "00. Consul 定位与学习路线"
sidebar_position: 0
description: "从服务发现、健康检查和一致性控制面理解 Consul，并掌握与 Nacos、etcd、Kubernetes 的选型边界。"
tags: [Consul, Service Discovery, Raft, Service Mesh]
---

# Consul 定位与学习路线

Consul 是面向服务网络的控制平面，核心能力包括服务注册与发现、健康检查、KV、ACL、多数据中心和基于 Consul Connect 的服务网格。它不是通用业务数据库，也不是 Kubernetes etcd 的替代品。

```text
Service注册到Agent
→ Agent通过Gossip传播成员状态
→ Server通过Raft提交Catalog状态
→ Client使用DNS/HTTP查询健康实例
→ 应用或代理连接目标
```

## 1. 三篇文章怎么学

1. 本文先建立定位、术语和选型边界；
2. [Agent、Server、Gossip、Raft、DNS 与一次服务发现路径](./01-Consul-Agent-Server-Gossip-Raft-DNS与一次服务发现路径.md)理解核心原理；
3. [部署、ACL、TLS、健康检查、选型与故障 Runbook](./02-Consul部署-ACL-TLS-健康检查-选型与故障Runbook.md)完成生产落地。

## 2. 与相邻技术的边界

| 技术 | 更擅长 | 何时优先 |
| --- | --- | --- |
| Consul | 跨虚机/多环境服务发现、健康、服务网络 | 混合基础设施、多数据中心 |
| Kubernetes Service/CoreDNS | 集群内原生发现 | 工作负载完全在 K8s 内 |
| Nacos | Java/微服务注册发现与动态配置 | Spring Cloud/国内微服务生态 |
| etcd | 强一致 KV 与控制器状态 | 自建控制面，不直接作为服务目录 |

## 3. 学习完成标准

- 能区分 Client Agent、Server Agent、Datacenter 与 WAN/LAN Gossip；
- 能解释 DNS 查询为何只返回健康实例；
- 能说明 Raft 丢失 Quorum 与 Gossip 异常的不同影响；
- 能设计 TLS、ACL、Token 最小权限和故障域；
- 能判断是否真的需要 Consul，而不是重复建设 Kubernetes 服务发现。

## 4. 必做实验

搭建 3 Server + 2 Client；注册带 TTL/HTTP Check 的服务；通过 DNS/HTTP 查询；停止一个 Server、破坏一个健康检查、轮换 Token；观察 Leader、Quorum、Catalog 和实际请求路径。

参考：[Consul Architecture](https://developer.hashicorp.com/consul/docs/architecture)、[Consul Service Discovery](https://developer.hashicorp.com/consul/docs/discover)。
