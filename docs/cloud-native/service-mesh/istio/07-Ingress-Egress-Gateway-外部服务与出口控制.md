---
title: "Ingress/Egress Gateway、外部服务与出口控制"
sidebar_label: "07. 入口、出口与 Gateway"
sidebar_position: 7
description: "沿外部请求进入和网格访问外部服务的路径，设计 Gateway、TLS、SNI、DNS 和出口审计。"
tags: [Istio, Ingress Gateway, Egress Gateway, TLS, ServiceEntry]
---

# Ingress/Egress Gateway、外部服务与出口控制

Gateway 是独立数据平面工作负载，不是 Istiod 的一部分。入口故障与应用 Sidecar 故障要分别扩容和排查；出口 Gateway 也不能天然阻止工作负载绕过网络策略。

## 1. Ingress 路径

```text
Client → DNS → LB → Ingress Gateway Listener
→ TLS终止/透传 → Route → Service Cluster
→ mTLS到Workload → Application
```

证书 SAN、SNI、Gateway Listener、Route Host 和 LB 健康检查必须一致。TLS Passthrough 与 Termination 使用不同的路由信息和证书位置。

## 2. Gateway 部署

Gateway 与控制平面解耦部署，设置 HPA、PDB、拓扑分散、连接排空、最大连接和资源限制。LB 探针应识别 Ready，避免把正在终止的 Pod 继续接流量。

## 3. Egress 路径

```text
Workload Proxy/ztunnel
→ ServiceEntry识别外部Host
→ 可选Egress Gateway
→ TLS Origination/透传
→ Firewall/NAT
→ External Service
```

要强制经过 Egress Gateway，还需 Kubernetes NetworkPolicy、CNI/Firewall 阻止直连。仅配置 VirtualService 不构成安全边界。

## 4. DNS 与动态地址

外部服务通过 DNS 变化时，理解 Sidecar/Gateway 的 DNS 解析模式、TTL 和连接复用。把巨大公网域名集合注册为 ServiceEntry 会扩大配置；通配 SNI 也会扩大出口权限。

## 5. 出口安全

- 默认拒绝还是默认允许要有迁移计划；
- 按 Service Account、Namespace、Host、端口授权；
- TLS 校验 CA/SAN，禁止长期跳过；
- 记录源身份、目标 Host/SNI、Bytes、状态和延迟；
- 保护代理免受任意目标和 SSRF；
- 外部 Secret/Token 不由网格明文记录。

## 6. 排障

入口按 DNS/LB → Listener → Filter Chain/SNI → Route → Cluster → Endpoint；出口按 DNS → ServiceEntry → Route → Egress Gateway → Firewall/NAT → 外部 TLS。使用同一请求 ID 对齐 LB、Envoy 与应用日志。

参考：[Istio Ingress](https://istio.io/latest/docs/tasks/traffic-management/ingress/)、[Egress](https://istio.io/latest/docs/tasks/traffic-management/egress/)。
