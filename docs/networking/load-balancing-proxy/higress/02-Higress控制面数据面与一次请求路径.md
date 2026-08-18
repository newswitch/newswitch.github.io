---
title: "Controller、Pilot/Config、Gateway/Envoy 与一次请求"
sidebar_label: "02. Controller、Pilot/Config、Gateway/Envoy 与一次请求"
sidebar_position: 2
description: "追踪 Higress 声明式配置从 Kubernetes/Nacos 到 Envoy 数据面和请求过滤链。"
tags: [Higress, Controller, Envoy, Architecture]
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

## 1. 配置路径 {/* #配置路径 */}

`kubectl apply` 仅表示 API Server 已持久化。还需资源 status accepted/resolved、Controller 无错误、xDS 无 NACK、Listener/Route/Cluster active 和真实请求命中。

## 2. 请求路径 {/* #请求路径 */}

```text
LB → Gateway Listener/TLS
→ HCM/filter chain
→ virtual host/route
→ auth/rate-limit/Wasm
→ cluster/endpoint/LB/connection pool
→ upstream → response filters/telemetry
```

插件顺序影响鉴权、改写和缓存。Route 命中不等于 Endpoint 健康；503 需区分 no route、no healthy upstream、circuit breaker 和 reset。

## 3. 故障边界 {/* #故障边界 */}

Controller 断开时 Gateway 可按最后配置继续，Endpoint/证书/策略不更新。Gateway 故障影响流量，Controller 正常不能补偿数据面容量。

## 4. 用一条请求串起控制面与数据面 {/* #用一条请求串起控制面与数据面 */}

本文以 Higress 2.2.x 为当前实验基线；部署前固定 Chart、Controller、Gateway/Envoy 和 Console 版本。给请求加入唯一 ID，依次证明：Gateway API/Ingress 资源被 controller 接收 → 配置下发成功 → listener/route/cluster 存在 → 请求命中上游。

```bash
kubectl get gateway,httproute,ingress -A
kubectl logs -n higress-system deploy/higress-gateway-controller --since=10m
kubectl logs -n higress-system deploy/higress-gateway --since=10m
curl -v -H 'X-Request-ID: path-lab' https://api.example.com/health
```

控制面短时故障时数据面通常继续使用最后有效配置，但新路由/后端不会更新；数据面故障则直接影响流量。故障注入要分别停止 controller 和单 gateway Pod，记录配置收敛、请求影响和恢复时间，不能笼统归因“网关坏了”。

## 5. 验收题 {/* #验收题 */}

- Apply 成功到数据面生效有哪些阶段？
- xDS NACK 表示什么？
- 控制面断开时旧流量为何可能继续？
- 一次请求会经过哪些 Filter/Cluster 层？

## 6. 参考资料 {/* #参考资料 */}

- [Higress architecture](https://higress.cn/en/docs/latest/overview/what-is-higress/)
