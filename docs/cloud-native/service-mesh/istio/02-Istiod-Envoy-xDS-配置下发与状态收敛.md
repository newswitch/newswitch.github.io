---
title: "Istiod、Envoy、xDS、配置下发与状态收敛"
sidebar_label: "02. Istiod、xDS 与配置收敛"
sidebar_position: 2
description: "从 Kubernetes/Istio 对象变化到 Istiod 生成 xDS，并由数据平面 ACK/NACK，分析配置生效链路。"
tags: [Istio, Istiod, Envoy, xDS, 配置下发]
---

# Istiod、Envoy、xDS、配置下发与状态收敛

Istio 配置生效是一个持续协调过程：Istiod 观察多个配置源，构建面向每个 Proxy 的配置视图，通过 xDS 推送；Envoy 校验并 ACK/NACK。`kubectl apply` 成功只是第一步。

## 1. 配置来源与转换

```text
Kubernetes Service / EndpointSlice / Pod
Istio CRD / Gateway API / MeshConfig
外部注册中心或多集群发现
              │
              ▼
           Istiod
  验证 → 合并 → 作用域过滤 → 生成Proxy视图
              │ ADS/xDS
              ▼
   Envoy Sidecar / Gateway / Waypoint / ztunnel相关配置面
```

Istiod 同时承担服务发现、配置分发和证书相关职责。它不是把 CRD 原样发给 Envoy，而是转换为 Envoy 能理解的 Listener、Route、Cluster、Endpoint、Secret 等资源。

## 2. xDS 资源心智模型

| 资源 | 回答的问题 |
| --- | --- |
| LDS | Proxy 监听哪些地址/端口，使用什么 Filter Chain |
| RDS | HTTP 请求按 Host、Path、Header 路由到哪里 |
| CDS | 有哪些 Upstream Cluster，连接池和 TLS 如何配置 |
| EDS | Cluster 当前有哪些 Endpoint 及健康/权重 |
| SDS | TLS 证书和 Secret 如何动态提供 |

实际使用常通过 ADS 在一个长期 gRPC 流中协调多类资源。Envoy 收到新版本后校验：成功返回 ACK，失败返回 NACK 并通常继续使用上一份可用配置。

## 3. 为什么不同 Proxy 的配置不一样

Istiod 会根据 Proxy 身份、Namespace、网络、Sidecar 作用域、ExportTo、Waypoint/Gateway 绑定和可见服务生成不同视图。把全集群所有服务都发给每个 Proxy 会增加内存、下发流量和更新成本。

因此排障不能只看“另一 Pod 的配置正确”。必须检查发生故障的具体 Proxy。

## 4. 四个状态层次

```text
1. API对象存在
2. 配置语义通过分析
3. Istiod生成并向目标Proxy推送
4. Proxy ACK并按新配置处理真实流量
```

`istioctl analyze` 能发现一部分静态/跨资源问题，但不能证明目标 Proxy 已连接、已 ACK 或 Upstream 真正健康。

`istioctl proxy-status` 常见判断：

- `SYNCED`：对应资源版本已同步；
- `STALE`：Proxy 与控制面版本不一致或长时间未 ACK；
- `NOT SENT`：该资源未向 Proxy 发送，可能正常也可能作用域不匹配；
- NACK/错误：配置被数据平面拒绝，需要查 Istiod 与 Proxy 日志。

不同 Istio 版本显示字段会变化，以当前 `istioctl` 输出为准。

## 5. 配置生效延迟

端到端延迟包括：

```text
API Watch延迟
→ Istiod事件队列与配置计算
→ xDS序列化/网络
→ Proxy校验和应用
→ 连接复用或DNS/Endpoint更新的可见时间
```

配置规模、Endpoint 数、Proxy 数、Istiod CPU/内存、网络和频繁 Deployment 变化都会影响收敛。连接已建立时，路由/Endpoint 变化也不一定立即终止旧连接。

## 6. 排障实战

### 6.1 先确定目标 Proxy

```bash
istioctl proxy-status
istioctl proxy-config bootstrap POD -n NS
```

核对 Proxy 连接的 Istiod Revision、Cluster ID、Network 和身份。

### 6.2 逐层查看配置

```bash
istioctl proxy-config listeners POD -n NS
istioctl proxy-config routes POD -n NS
istioctl proxy-config clusters POD -n NS
istioctl proxy-config endpoints POD -n NS
```

Listener 不存在先查端口/作用域；Route 不对查 Host/Gateway；Cluster 不对查 DestinationRule；Endpoint 为空查 Service/EndpointSlice、网络和健康。

### 6.3 对比期望与实际

保存变更前后的 Proxy Dump、Istiod 日志、配置对象 Generation 和流量指标。不要直接重启所有 Sidecar，这会销毁最重要的现场并制造连接风暴。

## 7. 控制平面容量与高可用

Istiod 多副本依赖 Kubernetes Leader Election/共享配置源处理控制任务，数据平面连接分布到实例。容量规划输入包括 Proxy 数、Service/Endpoint 数、配置对象、更新速率、证书请求和 Push 时间。

监控 xDS 连接、Push 数/耗时、拒绝、配置队列、Istiod CPU/内存和证书错误。高可用不仅是副本数，还需要反亲和、PDB、版本 Revision、网络和 API Server 依赖。

## 8. 验收实验

创建一条有效路由并观察 API → Istiod → Proxy → 流量；再制造 Host 不匹配和 Envoy 无法接受的测试配置，比较 `analyze`、Proxy Status、日志和 Data Plane Dump。最后扩展大量 Endpoint，测量 Push 时间和 Istiod 资源变化。

参考：[Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/)、[Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/)。
