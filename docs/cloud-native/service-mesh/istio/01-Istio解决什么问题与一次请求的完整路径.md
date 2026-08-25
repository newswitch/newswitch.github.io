---
title: "Istio 解决什么问题与一次请求的完整路径"
sidebar_label: "01. Istio 与一次请求路径"
sidebar_position: 1
description: "从客户端连接、流量劫持、Envoy/ztunnel、路由、mTLS 到目标工作负载，分析 Istio 数据平面。"
tags: [Istio, Envoy, Sidecar, Ambient, 请求路径]
---

# Istio 解决什么问题与一次请求的完整路径

Istio 解决的是服务间通信的统一治理问题：工作负载身份、mTLS、授权、路由、重试、熔断和遥测。如果只是把 Sidecar 注入 Pod，却没有建立身份、策略、SLO 和排障流程，只是给请求增加了一个代理跳点。

## 1. 控制平面与数据平面

```text
Kubernetes API / Istio APIs
          │
          ▼
       Istiod
  服务发现、配置转换、证书
          │ xDS/SDS
          ▼
Envoy Sidecar / ztunnel / waypoint
          │
          ▼
      真实业务流量
```

Istiod 不转发普通业务请求。它根据 Kubernetes Service/Endpoint 和 Istio/Gateway API 生成数据平面配置。业务流量由 Envoy、ztunnel、waypoint 和 Gateway 处理。因此 Istiod 短暂不可用时，已经获得配置的 Proxy 通常还能转发；新 Pod、证书和新配置可能受影响。

## 2. Sidecar 模式请求路径

假设 `frontend` 调用 `http://checkout:8080/pay`：

```text
frontend进程发起连接
→ Pod网络重定向到Outbound Envoy
→ Listener识别端口与协议
→ Route匹配Host/Path/Header
→ Cluster应用DestinationRule、负载均衡和连接池
→ Endpoint选择checkout Pod
→ Envoy使用工作负载证书建立mTLS
→ checkout Pod的Inbound Envoy
→ 授权、遥测和入站处理
→ checkout进程:8080
→ 响应沿相反方向返回
```

流量重定向可能由 `istio-init`/iptables 或 Istio CNI 完成，取决于安装方式。应用看到的源地址、连接复用和 DNS 行为会因为代理而变化，必须在容量与审计设计中说明。

## 3. Ambient 模式请求路径

Ambient 把 L4 安全覆盖层与 L7 功能拆开：

```text
frontend Pod
→ 节点ztunnel捕获流量
→ 根据工作负载身份建立HBONE/mTLS隧道
→ 可选frontend或目标Waypoint执行L7路由/授权/遥测
→ 目标节点ztunnel
→ checkout Pod
```

没有 Waypoint 时，ztunnel 主要提供 L4 连接、身份、mTLS、L4 策略和遥测；需要 HTTP 路由、L7 授权等能力时引入 Waypoint。不能把 Sidecar 时代的所有 EnvoyFilter 或拦截假设直接搬到 Ambient。

## 4. 一次请求使用哪些配置

| 阶段 | 主要对象 |
| --- | --- |
| 服务发现 | Service、EndpointSlice、ServiceEntry |
| 入口 | Gateway/Gateway API、VirtualService/HTTPRoute |
| 路由 | VirtualService、HTTPRoute |
| 目标与连接 | DestinationRule、Subset、TrafficPolicy |
| mTLS | PeerAuthentication、DestinationRule、工作负载证书 |
| 身份认证 | RequestAuthentication、JWT |
| 授权 | AuthorizationPolicy |
| 遥测 | Telemetry、Envoy 访问日志、Metrics/Trace 配置 |

对象创建成功只代表 Kubernetes API 接受 YAML，不代表选择器、Host、Gateway、作用域和数据平面配置正确。

## 5. 故障定位顺序

```text
应用请求失败
├─ DNS/Service/Endpoint是否存在
├─ 流量是否进入预期数据平面
├─ Proxy是否连接Istiod并同步xDS
├─ Listener/Route/Cluster/Endpoint是否正确
├─ mTLS握手和证书身份是否匹配
├─ AuthorizationPolicy是否拒绝
└─ Upstream应用是否健康、超时或过载
```

常用证据：

```bash
istioctl analyze -A
istioctl proxy-status
istioctl proxy-config listeners POD -n NAMESPACE
istioctl proxy-config routes POD -n NAMESPACE
istioctl proxy-config clusters POD -n NAMESPACE
istioctl proxy-config endpoints POD -n NAMESPACE
```

Ambient 环境还要检查 `ztunnel`、Waypoint、Gateway API 状态和对应的 `istioctl ztunnel-config` 能力，不能只用 Sidecar 命令判断。

## 6. 什么时候不适合直接引入

- 服务数量少且没有统一安全/流量治理需求；
- 团队还不能维护 Kubernetes、Envoy、证书和遥测；
- 应用协议无法被代理正确识别；
- 极端延迟/资源敏感且未做基线测试；
- 只想用网格掩盖应用没有超时、幂等和熔断的问题。

## 7. 验收实验

1. 对同一服务分别运行未入网格、Sidecar 和 Ambient 工作负载；
2. 查看请求实际经过的 Proxy、连接和证书身份；
3. 修改路由并验证 xDS 同步和真实流量比例；
4. 设为 STRICT mTLS，证明明文客户端失败；
5. 添加拒绝策略，使用允许/拒绝请求验证；
6. 停止 Istiod，再测试旧连接、新 Pod 和新配置的差异。

验收目标不是 `kubectl get pods` 全绿，而是能用数据平面证据解释每一次允许、拒绝、路由和重试。

参考：[Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/)、[Ambient Overview](https://istio.io/latest/docs/ambient/overview/)。
