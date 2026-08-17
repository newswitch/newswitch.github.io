---
title: "Envoy 从零到精通学习路线"
sidebar_label: "00. Envoy 从零到精通学习路线"
sidebar_position: 0
tags: [Envoy, xDS, Proxy, Service Mesh, Gateway, 学习路线]
description: "从 Listener、Filter、Cluster、Endpoint 和一次请求深入 xDS、负载均衡、TLS、可观测性、过载保护、扩展、性能和源码排障。"
---

# Envoy 从零到精通学习路线

现有服务网格模块有 Envoy 入门和构建模块文章，但不足以形成独立掌握路径。本路线从一次 downstream 请求进入 Listener 开始，追踪 Filter Chain、HTTP Connection Manager、Route、Cluster、Endpoint、连接池、负载均衡和 upstream response，再进入 xDS、过载、热重启和源码。

Envoy 发布节奏快，学习使用当前 stable minor，生产固定补丁镜像 digest，并检查版本支持和 API deprecation；`latest` 文档可能指向开发版本，不能直接当生产事实。

## 1. 一次请求

```text
Downstream connection
  → Listener / Listener Filter
  → Filter Chain match / TLS
  → Network Filter
  → HTTP Connection Manager / codec
  → HTTP Filters
  → Route
  → Cluster Manager
  → Endpoint / LB / connection pool
  → Upstream
  → response filter chain
  → access log / metrics / trace
```

## 2. 15 篇文章规划

| 编号 | 文章 | 优先级 | 状态 |
| --- | --- | --- | --- |
| V00 | Envoy 从零到精通学习路线 | P0 | 已完成 |
| V01 | [什么是 Envoy 与部署形态](../../../cloud-native/service-mesh/04-什么是Envoy.md) | P0 | 已完成 |
| V02 | [Listener、Filter Chain、HCM、Route、Cluster 与请求生命周期](./02-Listener-Filter-HCM-Route-Cluster与请求生命周期.md) | P0 | 已完成 |
| V03 | [Envoy 核心构建模块](../../../cloud-native/service-mesh/06-Envoy构建模块.md) | P0 | 已完成 |
| V04 | [静态配置、Docker、systemd、Envoy Gateway 与 K8s 部署](./04-Envoy静态配置Docker-systemd-Envoy-Gateway与Kubernetes部署.md) | P0 | 已完成 |
| V05 | [xDS、Bootstrap、ADS、SotW/Delta、ACK/NACK 与控制面](./05-xDS-Bootstrap-ADS-Delta与ACK-NACK.md) | P0 | 已完成 |
| V06 | [DNS/EDS、Health Check、LB、Outlier、Circuit Breaker 与 Retry](./06-服务发现健康检查负载均衡异常检测与重试.md) | P0 | 已完成 |
| V07 | [HTTP/1.1、HTTP/2、HTTP/3、gRPC、WebSocket 与 TCP/UDP](./07-HTTP-gRPC-WebSocket与TCP-UDP协议代理.md) | P1 | 已完成 |
| V08 | [TLS、mTLS、SDS、Certificate Rotation、RBAC/JWT/ext_authz](./08-TLS-mTLS-SDS-RBAC-JWT与外部授权.md) | P1 | 已完成 |
| V09 | [Stats、Access Log、Tracing、Admin、Tap 与请求调试](./09-Stats-AccessLog-Trace-Admin与请求调试.md) | P0 | 已完成 |
| V10 | [Threading、Connection Pool、Buffer、Overload Manager 与性能](./10-线程连接池Buffer过载保护与性能.md) | P1 | 已完成 |
| V11 | [Drain、Hot Restart、Runtime、灰度与无损升级](./11-Drain-Hot-Restart-Runtime与无损升级.md) | P1 | 已完成 |
| V12 | [Native/Wasm/Dynamic Module 与 Filter 扩展开发](./12-Native-Wasm-Dynamic-Module与Filter扩展.md) | P2 | 已完成 |
| V13 | [Sidecar、DaemonSet、Gateway、Service Mesh 与多级代理拓扑](./13-Sidecar-DaemonSet-Gateway与多级代理拓扑.md) | P1 | 已完成 |
| V14 | [Envoy 源码、xDS NACK、503/504、内存与生产故障 Runbook](./14-源码xDS-NACK-503-504内存与生产故障Runbook.md) | P2 | 已完成 |

当前完成 **15/15**，剩余 **0 篇**。

## 3. 必须掌握的术语

| Envoy 术语 | 含义 |
| --- | --- |
| Downstream | 连接到 Envoy 的客户端一侧 |
| Upstream | Envoy 将流量转发到的服务一侧 |
| Listener | 接收连接/数据报的 IP、端口和处理入口 |
| Filter Chain | 根据连接属性选择的一组网络/TLS处理 |
| Route | HTTP 请求到 Cluster 的匹配和策略 |
| Cluster | 一组逻辑 upstream 服务配置 |
| Endpoint | Cluster 中真实可连接的后端地址 |
| xDS | 控制面动态下发 Listener/Route/Cluster/Endpoint/Secret 等资源 |

## 4. 学习阶段

1. V01～V04：静态配置跑通一条真实请求并逐层观察；
2. V05～V06：理解控制面怎样动态改变数据面，以及负载均衡/异常检测的状态；
3. V07～V09：补齐协议、安全与可观测；
4. V10～V11：处理内存、过载、排空和升级；
5. V12～V14：扩展、拓扑、源码与生产 Runbook。

## 5. P0 验收题

- Listener、Route、Cluster、Endpoint 分别在哪个阶段被使用？
- xDS Server 下发配置后，Envoy ACK 与 NACK 表示什么？
- Health Check、Outlier Detection 与 Circuit Breaker 分别保护什么？
- Retry 为什么必须结合幂等、per-try timeout 和 retry budget？
- downstream TLS 与 upstream TLS 是不是同一条连接？
- Envoy 503 UC/UH/UF/NR 等响应标志如何缩小根因范围？
- Drain 为什么不等于立即杀死所有连接？
- Admin 端口为什么不能暴露给普通网络？
- CPU 不高但内存持续增长，应看连接池、Buffer、统计基数还是请求体？

## 6. 实验环境

```text
Static Envoy：Listener/Route/Cluster/Endpoint 与 Admin
自制 xDS：配置推送、ACK/NACK、Delta 与回滚
协议实验：HTTP/1.1、HTTP/2、gRPC、WebSocket、TCP
安全：downstream/upstream mTLS + SDS rotation
过载：慢客户端、大响应、连接池、重试风暴、Overload Manager
Kubernetes：Envoy Gateway / sidecar / edge gateway 对比
```

## 7. 官方资料

- [Envoy Stable Documentation](https://www.envoyproxy.io/docs)
- [Envoy Architecture Overview](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview)
- [Life of a Request](https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request.html)
- [Envoy Source](https://github.com/envoyproxy/envoy)

本路线会把每个 YAML 资源对应到运行时请求对象和源码管理器，避免把 Envoy 学成一堆互不相干的配置字段。
