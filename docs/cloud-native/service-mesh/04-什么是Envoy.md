---
title: "什么是 Envoy？"
sidebar_label: "04. 什么是 Envoy？"
sidebar_position: 4
tags: [Kubernetes, 服务网格, PartII, 学习路线]
description: "Envoy 是一个高性能的代理服务器，专为现代微服务架构设计。它提供进程外架构、多层过滤器、动态配置、负载均衡等功能，可作为 Sidecar 或边缘代理部署，帮助解决服务间通信的复杂性。"
---

# 什么是 Envoy？

> Envoy 让服务间通信变得可观、可控、可扩展，是现代云原生架构的“网络底座”。

本文是概念入口。实际学习请使用 [Envoy 从零到精通学习路线](../../networking/load-balancing-proxy/envoy/00-Envoy从零到精通学习路线.md)，并固定一个 stable minor/补丁镜像；`latest` 文档和开发版能力不能直接当成生产版本事实。

## 先建立两条主线

```text
配置路径：bootstrap / xDS control plane
  → Listener / Route / Cluster / Endpoint / Secret
  → validate / warm / ACK-NACK / active

请求路径：downstream connection
  → Listener / Filter Chain / HCM / HTTP Filters / Route
  → Cluster / Endpoint / connection pool
  → upstream response / access log / metrics / trace
```

Envoy 是数据面代理，不会自己理解 Kubernetes Service、业务租户或发布意图。静态配置或控制面把这些意图翻译成 Envoy 资源，Envoy 再在每条连接/请求上执行。

随着 IT 行业向微服务架构和云原生解决方案的转型，企业面临着管理数百个微服务的挑战。这些使用不同技术栈开发的服务带来了系统复杂性和调试难题。

作为应用开发者，你专注于业务逻辑——如处理订单或生成报表。然而，任何业务操作都涉及多个服务间的调用，每个服务都有自己的超时机制、重试逻辑和网络相关代码。

当请求失败时，很难跨多个服务追踪问题根源。是网络不稳定？需要调整重试策略？还是业务逻辑错误？服务间不一致的日志和跟踪机制进一步增加了调试复杂性。

Envoy 的解决方案是将网络问题从应用程序中抽离，由专门的组件处理网络通信，使调试变得更加简单。

## 部署模式

Envoy 通常以两种模式部署：

- **Sidecar 模式**：每个服务实例旁边运行一个 Envoy 实例
- **边缘代理模式**：作为 API 网关部署在系统边界

在 Sidecar 模式下，Envoy 与应用程序形成原子实体但保持独立进程。应用程序专注业务逻辑，Envoy 处理网络通信。这种关注点分离使故障排查更容易，能快速确定问题来源于应用还是网络。

## 核心特性

### 进程外架构

Envoy 是独立进程，设计为与每个应用程序并行运行。多个 Envoy 实例通过集中配置形成透明的服务网格。

应用程序向虚拟地址（localhost）而非真实地址发送请求，无需了解网络拓扑。路由责任完全委托给 Envoy，使网络配置与应用程序解耦。

这种架构的优势：

- **语言无关**：支持 Go、Java、C++、Python 等任何编程语言
- **一致性**：在不同技术栈间保持统一的网络行为
- **独立升级**：可透明地在整个基础设施中部署和升级 Envoy

### L3/L4 网络处理与过滤器架构

Envoy 能接受 TCP/UDP 连接或数据报，并通过 Listener、Filter Chain 和 Network Filter 处理 L4 流量；启用 HTTP Connection Manager 后，它会解析并代理 L7 HTTP。它不是只能依据 IP 和端口做决定：Filter Chain 可以使用 SNI、ALPN 等连接属性，HTTP Route 还可以使用域名、路径和 Header。它采用可插拔过滤器链架构，可类比为有固定生命周期与方向的处理管线：

```bash
ls -l | grep "*.go" | wc -l
```

通过堆叠过滤器构建处理逻辑，支持：

- TCP/UDP 代理
- TLS 客户端认证
- 连接限制
- 网络级监控

### L7 过滤器架构

在 HTTP 连接管理子系统中，Envoy 支持 HTTP L7 过滤器层，可执行：

- 请求/响应缓冲
- 速率限制
- 路由转发
- 认证授权
- 内容转换

### HTTP/2 和 HTTP/3 支持

Envoy 可以处理 HTTP/1.1、HTTP/2，并在满足构建、Listener、QUIC/UDP、TLS 与客户端条件时处理 HTTP/3。Downstream 和 upstream 是两段独立协议，只有显式配置并经兼容性验证才会发生转换；把 HTTP/1.1 应用放到 Envoy 后面不会自动获得 HTTP/2 的所有收益。

是否采用 HTTP/2/3 应由 gRPC/流式能力、连接复用、流控制、上游兼容和故障域共同决定。HTTP/2 单连接承载多个 Stream，也可能带来单连接 reset、流控制和长连接排空问题，不能一概要求“全面使用”。

### 智能路由

在 HTTP 模式下，Envoy 支持强大的路由功能：

- 基于路径、域名、请求头的路由
- 内容类型路由
- 权重路由和流量分割
- 重定向和重写

这些功能在构建 API 网关和服务网格时都非常有用。

### gRPC 原生支持

Envoy 完全支持 gRPC 所需的 HTTP/2 功能，包括：

- 双向流
- 流量控制
- 连接复用
- 负载均衡

### 动态配置

除了静态配置文件，Envoy 支持通过 xDS（发现服务）API 进行动态配置：

- **CDS**（集群发现服务）：动态更新后端集群
- **EDS**（端点发现服务）：动态更新服务实例
- **LDS**（监听器发现服务）：动态更新监听配置
- **RDS**（路由发现服务）：动态更新路由规则

这使得 Envoy 能够适应动态的云原生环境。

动态配置有四个不同阶段：控制面保存、Envoy 收到并 ACK、依赖完成 warming 后 active、真实请求命中。`ACK` 不等于业务流量正确；`NACK` 时要根据 node、资源类型、nonce/version 和 error detail 定位，并确认 Envoy 当前仍使用的最后有效版本。详见 [xDS、ADS、Delta 与 ACK/NACK](../../networking/load-balancing-proxy/envoy/05-xDS-Bootstrap-ADS-Delta与ACK-NACK.md)。

## 高级功能

### 健康检查

Envoy 提供主动和被动健康检查：

- **主动检查**：定期探测上游服务健康状态
- **被动检查**：通过异常检测识别不健康的服务

只有健康的服务实例才会接收流量。

### 负载均衡

支持多种负载均衡算法和高级功能：

- 轮询、最少连接、随机等算法
- 自动重试机制
- 断路器模式
- 全局速率限制
- 流量镜像
- 请求对冲

### 可观测性

Envoy 提供全面的可观测性支持：

- **指标**：支持 Prometheus、StatsD 等格式
- **日志**：结构化访问日志和错误日志
- **分布式追踪**：支持 Jaeger、Zipkin、OpenTelemetry

### 安全性

- **mTLS**：服务间双向 TLS 认证
- **TLS 终止**：边缘代理 TLS 处理
- **认证集成**：支持 JWT、OAuth2 等认证机制
- **授权策略**：基于角色的访问控制

## 应用场景

Envoy 适用于多种场景：

1. **服务网格数据平面**：作为 Istio、Consul Connect 等服务网格的数据平面
2. **API 网关**：构建高性能的 API 网关
3. **边缘代理**：处理入口流量和 TLS 终止
4. **负载均衡器**：替代传统的硬件或软件负载均衡器

Envoy 已成为现代微服务架构中不可或缺的基础设施组件，为构建可靠、可扩展的分布式系统提供了强大支撑。

## 能力边界与掌握标准

- Envoy 的重试、超时和熔断不能替代业务幂等与数据一致性；
- mTLS 证明工作负载身份，不替代用户/对象级授权；
- 健康检查和异常检测不能创造上游容量；
- xDS 控制面、SDS、外部鉴权和遥测后端都是独立故障域；
- Admin 接口包含配置与控制能力，只能放在受控管理网络。

完成入门后，你应能说清 downstream/upstream 两段连接、Listener→Route→Cluster→Endpoint 请求路径，以及静态配置与 xDS 控制面的责任边界，再进入 [请求生命周期](../../networking/load-balancing-proxy/envoy/02-Listener-Filter-HCM-Route-Cluster与请求生命周期.md) 实验。
