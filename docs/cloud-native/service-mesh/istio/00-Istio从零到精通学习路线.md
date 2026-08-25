---
title: "Istio 从零到精通学习路线"
sidebar_label: "00. Istio 从零到精通学习路线"
sidebar_position: 0
description: "从一次请求和 xDS 配置下发开始，系统学习 Sidecar/Ambient、流量治理、mTLS、授权、Telemetry、多集群、升级和故障排查。"
tags: [Istio, Envoy, Ambient Mesh, mTLS, 服务网格]
---

# Istio 从零到精通学习路线

Istio 把服务间通信的流量控制、身份认证、授权和遥测能力下沉到数据平面。学习它不能只记住 `VirtualService` 和 `DestinationRule`，必须同时理解 Kubernetes 服务发现、Istiod 如何生成 xDS、Envoy/ztunnel/waypoint 如何处理数据包，以及配置错误时请求究竟在哪一层失败。

本路线同时覆盖两种数据平面：

```text
Sidecar模式：Application Pod ↔ Envoy Sidecar ↔ Network

Ambient模式：Application Pod
             → ztunnel（节点L4安全隧道）
             → 可选Waypoint（L7策略与流量治理）
             → 目标ztunnel/Workload
```

## 1. P0：架构和请求路径

1. [Istio 解决什么问题与一次请求的完整路径](./01-Istio解决什么问题与一次请求的完整路径.md)
2. [Istiod、Envoy、xDS、配置下发与状态收敛](./02-Istiod-Envoy-xDS-配置下发与状态收敛.md)
3. [`istioctl`、Helm、Profiles、Revision 与生产安装验收](./03-istioctl-Helm-Profiles-Revision与生产安装验收.md)
4. [Sidecar 注入、iptables/CNI、Ambient、ztunnel 与 Waypoint](./04-Sidecar注入-iptables-CNI-Ambient-ztunnel与Waypoint.md)

完成 P0 后，应能分别画出 Sidecar 和 Ambient 请求路径，并区分“CR 已创建、Istiod 已接受、Proxy 已同步、真实流量已生效”四个不同状态。

## 2. P1：流量、安全与可观测性

5. [VirtualService、DestinationRule、Gateway API、ServiceEntry 与配置作用域](./05-VirtualService-DestinationRule-Gateway-API-ServiceEntry与作用域.md)
6. [负载均衡、超时、重试、熔断、故障注入、金丝雀与流量镜像](./06-负载均衡-超时-重试-熔断-故障注入-金丝雀与镜像.md)
7. [Ingress Gateway、Egress Gateway、外部服务和出口控制](./07-Ingress-Egress-Gateway-外部服务与出口控制.md)
8. [SPIFFE 身份、证书签发、mTLS、PeerAuthentication 与 DestinationRule](./08-SPIFFE身份-证书签发-mTLS-PeerAuthentication与DestinationRule.md)
9. [RequestAuthentication、AuthorizationPolicy、JWT 与外部授权](./09-RequestAuthentication-AuthorizationPolicy-JWT与外部授权.md)
10. [Metrics、Access Log、Trace、Telemetry API、Prometheus、Grafana 与 Kiali](./10-Metrics-Access-Log-Trace-Telemetry-Prometheus-Grafana与Kiali.md)
11. [Proxy 资源、配置规模、连接、TLS、容量规划与性能压测](./11-Proxy资源-配置规模-连接-TLS-容量规划与性能压测.md)

## 3. P2：多集群、升级和故障处理

12. [多集群、多网络、East-West Gateway、服务发现与故障域](./12-多集群-多网络-East-West-Gateway-服务发现与故障域.md)
13. [Revision/Tag、金丝雀升级、Sidecar/Ambient 迁移、兼容与回滚](./13-Revision-Tag-金丝雀升级-Sidecar-Ambient迁移与回滚.md)
14. [`istioctl`、Envoy Admin、日志、xDS 与生产故障 Runbook](./14-istioctl-Envoy-Admin-xDS与生产故障Runbook.md)

## 4. 必做实验

- 安装 Sidecar 与 Ambient 测试网格，并明确版本和 Profile；
- 观察一条请求的入站/出站 Listener、Route、Cluster 和 Endpoint；
- 制造 VirtualService Host/Gateway 不匹配和 xDS `STALE`；
- 灰度 10% 流量，验证请求数而不只看 YAML；
- 测试 Timeout、Retry 和 Circuit Breaker 的放大效应；
- 从 `PERMISSIVE` 迁移到 `STRICT` mTLS，定位明文客户端；
- 创建拒绝优先的 AuthorizationPolicy 并验证允许/拒绝矩阵；
- 停止 Istiod，验证已有数据平面与新配置的不同边界；
- 演练 Gateway、ztunnel、waypoint 和 Sidecar 故障；
- 使用 Revision 完成升级和回滚。

## 5. 已有补充阅读

- [什么是 Istio](../02-什么是Istio.md)
- [你是否需要 Istio](../03-你是否需要Istio.md)
- [什么是 Envoy](../04-什么是Envoy.md)
- [服务网格部署模式](../05-服务网格部署模式.md)

## 6. 学习完成标准

- 能解释数据平面和控制平面失效的不同影响；
- 能沿 Kubernetes Service → Istiod → xDS → Proxy → Upstream 定位问题；
- 能为 Sidecar 与 Ambient 选择适合的能力层；
- 能设计流量治理而不制造重试风暴；
- 能验证工作负载身份、mTLS、JWT 和授权策略；
- 能建设网格 SLO、容量模型、升级和生产 Runbook。

参考：[Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/)、[Sidecar or Ambient](https://istio.io/latest/docs/overview/dataplane-modes/)。
