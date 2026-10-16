---
title: "Proxy 资源、配置规模、连接、TLS、容量规划与性能压测"
sidebar_label: "11. 容量规划与性能压测"
sidebar_position: 11
description: "以请求、连接、Proxy、Service、Endpoint 和配置更新为输入，规划 Istio 数据面和控制面容量。"
tags: [Istio, 容量规划, Envoy, 性能测试, Istiod]
---

# Proxy 资源、配置规模、连接、TLS、容量规划与性能压测

Istio 成本分为数据平面每请求成本和控制平面配置成本。只测试平均延迟会漏掉连接风暴、证书轮换和大规模 xDS Push。

## 1. 容量输入

```text
数据面：RPS、并发连接、请求/响应大小、TLS、协议、Filter、日志/Trace
控制面：Proxy数、Service/Endpoint数、配置对象、更新频率、证书请求
```

Sidecar 资源按 Pod 分散；Ambient ztunnel 按节点共享，Waypoint 按作用域共享。共享代理更容易提高利用率，也要防止单热点影响多个服务。

## 2. 延迟拆分

```text
总延迟 = 捕获/代理排队 + 路由/Filter
       + TLS/连接建立 + Upstream网络
       + 应用处理 + 返回路径
```

长连接稳态与短连接 TLS 风暴完全不同。分别测 HTTP/1.1、HTTP/2、gRPC、TCP、Keepalive、冷/热连接和证书轮换。

## 3. 配置规模

每个 Proxy 可见的 Service/Endpoint 越多，Config Dump、内存、xDS 序列化和 Push 越大。通过 Sidecar/作用域、Namespace 边界和合理服务注册减少无关配置，但不要造成目标不可见。

## 4. 压测矩阵

| 变量 | 场景 |
| --- | --- |
| 模式 | 无网格、Sidecar、Ambient L4、Ambient+Waypoint |
| 策略 | mTLS、JWT、授权、Retry、Telemetry |
| 连接 | 短连接、长连接、连接风暴 |
| 故障 | Endpoint退出、Istiod重启、Gateway扩缩容 |
| 配置 | Endpoint大批变化、路由批量更新 |

记录应用与 Proxy CPU/内存、P50/P99、连接、Reset/Overflow、TLS 握手、Istiod Push 时间和配置大小。

## 5. 调优原则

先删除无价值 Filter/日志/Trace 和无关配置，再调资源；限制重试；复用连接；为 Gateway/Waypoint 独立 HPA；给 Sidecar 设置合理 Request，避免调度器忽略网格成本。

## 6. 容量验收

正常峰值 1.5～2 倍压测后，做单 Proxy/节点/控制平面副本故障，验证剩余实例的资源和 P99。容量结论附版本、配置、拓扑和工作负载，不能跨版本直接复用。

参考：[Istio Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/)。
