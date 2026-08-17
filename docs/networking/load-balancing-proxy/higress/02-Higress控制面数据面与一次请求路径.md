---
title: "Controller、Pilot/Config、Gateway/Envoy 与一次请求"
sidebar_label: "02. Controller、Pilot/Config、Gateway/Envoy 与一次请求"
sidebar_position: 2
tags: [Higress, Controller, Envoy, Architecture]
description: "追踪 Higress 声明式配置从 Kubernetes/Nacos 到 Envoy 数据面和请求过滤链。"
---

# Controller、Pilot/Config、Gateway/Envoy 与一次请求

具体组件名随版本演进，职责稳定：

```text
Ingress/Gateway API/Policies + service discovery
→ controller watches/validates/resolves
→ translate to Envoy xDS resources
→ Gateway ACK/warms/listens
→ status/metrics report effective config
```

## 配置路径

`kubectl apply` 仅表示 API Server 已持久化。还需资源 status accepted/resolved、Controller 无错误、xDS 无 NACK、Listener/Route/Cluster active 和真实请求命中。

## 请求路径

```text
LB → Gateway Listener/TLS
→ HCM/filter chain
→ virtual host/route
→ auth/rate-limit/Wasm
→ cluster/endpoint/LB/connection pool
→ upstream → response filters/telemetry
```

插件顺序影响鉴权、改写和缓存。Route 命中不等于 Endpoint 健康；503 需区分 no route、no healthy upstream、circuit breaker 和 reset。

## 故障边界

Controller 断开时 Gateway 可按最后配置继续，Endpoint/证书/策略不更新。Gateway 故障影响流量，Controller 正常不能补偿数据面容量。

## 验收题

- Apply 成功到数据面生效有哪些阶段？
- xDS NACK 表示什么？
- 控制面断开时旧流量为何可能继续？
- 一次请求会经过哪些 Filter/Cluster 层？

## 参考资料

- [Higress architecture](https://higress.cn/en/docs/latest/overview/what-is-higress/)
