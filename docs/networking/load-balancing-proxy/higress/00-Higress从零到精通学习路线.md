---
title: "Higress 从零到精通学习路线"
sidebar_label: "00. Higress 从零到精通学习路线"
sidebar_position: 0
description: "从 Higress 控制面与 Envoy 数据面深入 Gateway API、服务发现、流量、安全、Wasm、AI 网关、性能容量和生产排障。"
tags: [Higress, API Gateway, AI Gateway, Envoy, Wasm, 学习路线]
---

# Higress 从零到精通学习路线

Higress 不是“带控制台的 Nginx”。它以 Istio/Envoy 为内核，向上提供 Ingress/Gateway API、微服务网关、安全插件、Wasm 扩展和 AI Gateway 能力。学习时必须分清控制面配置、Envoy 数据面生效、Kubernetes/Nacos 服务发现和请求实际转发。

本路线使用当前官方 stable Helm Chart，所有实验固定 Chart、Controller、Gateway、Envoy 和 CRD 版本。

## 1. 请求和配置路径

```text
Config path
Ingress/Gateway API/Console/Plugin CR
  → Higress Controller
  → translate / validate
  → xDS
  → Envoy Gateway

Request path
Client → LB → Higress Gateway Listener
  → route / auth / rate-limit / Wasm
  → service discovery endpoint
  → upstream
  → response stream / observability
```

## 2. 篇文章规划 {/* #2-13-篇文章规划 */}

| 编号 | 文章 | 优先级 | 核心问题 | 状态 |
| --- | --- | --- | --- | --- |
| H00 | Higress 从零到精通学习路线 | P0 | 建立控制面、数据面和插件地图 | 已完成 |
| H01 | [Higress、Nginx、Envoy、Ingress 与 API Gateway 选型](./01-Higress-Nginx-Envoy-Ingress与API-Gateway选型.md) | P0 | 产品层次和场景边界 | 已完成 |
| H02 | [Controller、Pilot/Config、Gateway/Envoy 与一次请求](./02-Higress控制面数据面与一次请求路径.md) | P0 | 配置怎样变成数据面路由 | 已完成 |
| H03 | [Kind、Helm、Docker、标准 K8s 与生产 HA 部署](./03-Higress-Kind-Helm-Docker标准Kubernetes与生产HA部署.md) | P0 | 多种部署、入口和升级 | 已完成 |
| H04 | [Ingress、Gateway API、Domain、Route 与 Backend](./04-Ingress-Gateway-API-Domain-Route与Backend.md) | P0 | 声明式路由模型 | 已完成 |
| H05 | [Kubernetes、Nacos、DNS、Dubbo 服务发现](./05-Kubernetes-Nacos-DNS-Dubbo服务发现.md) | P0 | Endpoint 来源和同步故障 | 已完成 |
| H06 | [负载均衡、重试、超时、熔断、健康与流量灰度](./06-负载均衡重试超时熔断健康与灰度.md) | P0 | 可靠流量治理边界 | 已完成 |
| H07 | [TLS、mTLS、JWT/OIDC、Key Auth、WAF 与安全](./07-TLS-mTLS-JWT-OIDC-Key-Auth与WAF.md) | P1 | 边界认证和授权 | 已完成 |
| H08 | [限流、限并发、配额、降级与多租户](./08-限流限并发配额降级与多租户.md) | P1 | 保护网关和上游 | 已完成 |
| H09 | [Wasm Plugin、Go/Rust/JS SDK、生命周期与安全](./09-Wasm-Plugin与扩展开发.md) | P2 | 扩展怎样进入请求 Filter Chain | 已完成 |
| H10 | [AI Gateway、SSE、模型路由、Token 限流、Fallback 与缓存](./10-AI-Gateway模型路由SSE与Token治理.md) | P1 | LLM 流量的专有问题 | 已完成 |
| H11 | [Access Log、Metrics、Trace、Dashboard、容量与压测](./11-可观测性容量规划与压测.md) | P1 | 从请求到上游的可观测性 | 已完成 |
| H12 | [配置不生效、503/504、流式中断、升级与源码 Runbook](./12-配置503-504流式中断升级与源码Runbook.md) | P2 | 控制面到数据面的故障定位 | 已完成 |

当前完成 **13/13**，剩余 **0 篇**。

## 3. 学习重点

### 3.1 不把控制台当真相 {/* #不把控制台当真相 */}

配置已经保存，只证明控制面接收；还要确认 CR/配置验证、xDS 下发、Envoy ACK/NACK、Listener/Route/Cluster/Endpoint 和真实请求。

### 3.2 AI Gateway 不是普通 HTTP 代理加一个域名 {/* #ai-gateway-不是普通-http-代理加一个域名 */}

LLM 请求需要处理长时间连接、SSE 流、首 Token 延迟、输出 Token、客户端取消、模型级并发、Fallback、内容安全和成本计量。缓存也必须考虑 Prompt、模型、采样参数和权限隔离。

### 3.3 插件必须进入性能预算 {/* #插件必须进入性能预算 */}

Wasm 提供隔离和热更新，但插件仍会消耗 CPU、内存并影响请求延迟；需要限制执行、内存、外部调用和失败策略。

## 4. P0 验收题

- Gateway API/Ingress 配置经过哪些组件才成为 Envoy 路由？
- 控制面显示成功，数据面为什么可能仍使用旧配置？
- Nacos 中实例变化后，Higress 的 Endpoint 在哪里观察？
- Retry 为什么可能放大非幂等请求和上游压力？
- 503、504 分别可能在路由、连接、超时还是上游产生？
- SSE 首包正常但中途断流，应怎样区分客户端、LB、Gateway、插件和模型服务？
- Token 限流与请求数限流为何不能互相替代？
- 多个 Gateway Pod 在同节点时是否高可用？

## 5. 实验环境

```text
Kind：Gateway API、Route、Wasm 和基础流量
3 worker K8s：Gateway HA、PDB、滚动升级和节点故障
Nacos + Dubbo/Spring：服务发现同步
vLLM/SGLang：SSE、模型路由、Token 指标和故障降级
压力环境：短 HTTP + 长流式 + 插件开销混合负载
```

## 6. 官方资料

- [Higress Documentation](https://higress.cn/en/docs/latest/)
- [What Is Higress](https://higress.cn/en/docs/latest/overview/what-is-higress)
- [Higress Quick Start](https://higress.cn/en/docs/latest/user/quickstart/)
- [Higress Source](https://github.com/alibaba/higress)

路线会与 [Nacos](../../../cloud-native/nacos/00-Nacos从零到精通学习路线.md)、[Envoy](../envoy/00-Envoy从零到精通学习路线.md) 和大模型推理模块串联，最终形成“控制面配置→网关→模型服务→流式响应”的完整路径。
