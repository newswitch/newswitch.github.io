---
title: "VirtualService、DestinationRule、Gateway API、ServiceEntry 与作用域"
sidebar_label: "05. 流量配置对象与作用域"
sidebar_position: 5
description: "解释 Istio 路由和目标策略对象如何组合，以及 Host、Namespace、exportTo 和 Gateway 作用域。"
tags: [Istio, VirtualService, DestinationRule, Gateway API, ServiceEntry]
---

# VirtualService、DestinationRule、Gateway API、ServiceEntry 与作用域

VirtualService 决定请求匹配后去哪个逻辑目标，DestinationRule 定义到达该目标后的 Subset、负载均衡、连接和 TLS 策略。二者职责不同，Host 与作用域不一致时 YAML 有效但不会按预期生效。

## 1. 对象关系

```text
Gateway/Sidecar接收请求
→ VirtualService或HTTPRoute匹配Host/Path/Header
→ 选择Service Host + Subset
→ DestinationRule解析Subset与TrafficPolicy
→ Service Discovery给出Endpoints
→ Envoy Cluster/Endpoint转发
```

ServiceEntry 把网格外服务或非 Kubernetes 服务注册进服务模型，WorkloadEntry 可描述外部 Workload。

## 2. Host 与 Namespace

短 Host 名通常按资源所在 Namespace 解析，不一定按客户端 Namespace。生产跨 Namespace 使用 FQDN，明确 `exportTo` 和引用权限。Gateway API 还通过 ParentRefs、AllowedRoutes 和 ReferenceGrant 控制绑定。

## 3. Subset

```yaml
subsets:
  - name: v2
    labels:
      version: v2
```

Subset Label 必须匹配真实 Endpoint Pod。Subset 没有成员时，路由会生成但请求失败。发布前查询 Endpoint，而不是只核对 Deployment Label 模板。

## 4. Gateway API 与 Istio API

两套 API 可在同一平台存在，但团队应规定入口、网格内路由和迁移标准。不要为同一 Host 同时配置重叠规则，避免优先级和所有权不清。新功能支持度按固定 Istio/Gateway API 版本验证。

## 5. ServiceEntry 风险

`REGISTRY_ONLY`/`ALLOW_ANY` 等出口策略决定未知外部流量行为。ServiceEntry 只描述服务，不自动保证 DNS、TLS 身份和授权安全。访问公网还要限制 Host、端口、协议、SNI 和 Egress 路径。

## 6. 排障

1. `istioctl analyze -A` 查引用和冲突；
2. 确定请求实际经过的 Gateway/Proxy；
3. 查 Route 是否出现目标 Host/规则；
4. 查 Cluster 是否带预期 Subset/TLS；
5. 查 Endpoint 是否非空；
6. 发请求验证命中比例和响应版本。

## 7. 验收

创建两个版本，先用 Header 路由，再按权重灰度；故意制造错误 Namespace 短 Host、空 Subset 和未允许 ParentRef，观察 Status、xDS 与真实错误。

参考：[Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/)、[Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/)。
