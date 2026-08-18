---
title: "Higress、Nginx、Envoy、Ingress 与 API Gateway 选型"
sidebar_label: "01. Higress、Nginx、Envoy、Ingress 与 API Gateway 选型"
sidebar_position: 1
description: "先区分规范、控制面、数据面与产品，再按流量类型、扩展、安全、运维和 AI 网关需求选择 Higress、Nginx 或 Envoy。"
tags: [Higress, Nginx, Envoy, Ingress, API Gateway]
---

# Higress、Nginx、Envoy、Ingress 与 API Gateway 选型

Higress、Nginx、Envoy、Ingress 经常被放在同一张“网关对比表”里，但它们不处在完全相同层次：Ingress/Gateway API 是 Kubernetes API 规范，Nginx 和 Envoy 是代理数据面，Ingress Controller/API Gateway 是把声明式配置转换成代理配置的控制面与产品。Higress 则组合了云原生网关控制面、Envoy 数据面、服务发现与插件生态。

## 1. 先画清层次

```text
Declarative APIs
  ├─ Kubernetes Ingress
  └─ Kubernetes Gateway API
          ↓ watched/reconciled by
Gateway control plane / controller
  ├─ route and policy validation
  ├─ service discovery integration
  ├─ config translation / distribution
  └─ status and lifecycle
          ↓ configures
Proxy data plane
  ├─ Nginx
  └─ Envoy
          ↓ handles
TCP/TLS/HTTP/gRPC requests
```

Higress 是一套网关实现/产品，而不是一种新的传输协议。讨论选型时应明确比较的是“开源 Nginx 单实例配置”“某个 Nginx Ingress Controller”“原生 Envoy”“基于 Envoy 的 Higress”，否则结论没有可比性。

## 2. 四个概念分别是什么

### 2.1 Kubernetes Ingress {/* #kubernetes-ingress */}

Ingress 是较早的 Kubernetes HTTP/HTTPS 入口 API，表达 Host/Path 到 Service 的路由。许多高级能力依赖各 Controller 的 Annotation，因此可移植性有限。

### 2.2 Gateway API {/* #gateway-api */}

Gateway API 将基础设施拥有者、集群运营者和应用路由拥有者的职责拆得更清楚，通过 GatewayClass、Gateway、HTTPRoute 等资源表达入口与路由，并可扩展策略。

### 2.3 Nginx {/* #nginx */}

Nginx 是成熟的事件驱动 Web Server 与代理，静态配置、反向代理、缓存、TLS 和 HTTP 能力清晰。动态服务发现、插件治理、租户控制面和复杂云原生策略需要额外组件或产品。

### 2.4 Envoy {/* #envoy */}

Envoy 是面向动态配置和可观测性的 L4/L7 代理，使用 Listener、Filter、Route、Cluster、Endpoint 与 xDS 组织数据面。它提供构建网关/Service Mesh 的内核，但裸 Envoy 不等于带 UI、租户、策略和发布流程的完整网关平台。

### 2.5 Higress {/* #higress */}

Higress 以 Envoy 为数据面，围绕 Kubernetes Ingress/Gateway API、服务发现、Wasm 插件、可观测性和 AI Gateway 场景提供控制面与产品能力。选用它仍需要理解底层 Envoy 的连接池、超时、重试、路由和资源模型。

## 3. 按问题而不是品牌选型

| 问题 | Nginx | 原生 Envoy | Higress |
| --- | --- | --- | --- |
| 简单静态反代/站点 | 很合适 | 可以但较重 | 通常不是最小方案 |
| 动态 xDS/Service Mesh 数据面 | 非原生核心路径 | 强项 | 由产品控制面管理 |
| Kubernetes 声明式网关 | 依赖具体 Controller | 需控制面 | 核心场景 |
| Wasm 插件治理 | 非通用核心方式 | 支持扩展能力 | 提供网关插件体系 |
| 多注册中心服务发现 | 需额外集成 | 由控制面下发 | 提供产品化集成 |
| AI 模型路由/鉴权/限流 | 可自行实现 | 可由 Filter/控制面实现 | 有专门 AI Gateway 能力 |
| 极简运维与少量配置 | 较优 | 需要理解资源模型 | 需要运维控制面+数据面 |

表格只是初筛，最终要用真实路由数、连接数、协议、更新频率、故障域、插件和团队能力做 PoC。

## 4. 一条配置怎样变成请求行为

以 Higress/Gateway API 为例：

```text
Git/CI applies Gateway + HTTPRoute + policy
→ Kubernetes API persists resources
→ controller watches desired state
→ validate ownership and references
→ resolve Service/Nacos endpoints
→ translate to Envoy resources
→ distribute config to gateway pods
→ Envoy accepts and warms dependencies
→ status/metrics report effective state
→ request matches listener/filter/route/cluster
```

配置提交成功、Controller 已处理、数据面 ACK、Listener/Route 已生效是不同阶段。生产发布必须观测资源 status、控制面日志、xDS/配置版本和数据面路由，而不是只看 `kubectl apply` 返回成功。

## 5. 一次请求的公共路径

无论产品名是什么，L7 网关大致都要处理：

```text
DNS / Load Balancer
→ TCP/TLS termination
→ listener / virtual host / route match
→ authentication and authorization
→ rate limit / WAF / request transform
→ service discovery / load balancing
→ upstream connection pool
→ retry / timeout / circuit breaking
→ response filters / telemetry
→ client
```

选型必须覆盖这条路径的每一个责任人。若云负载均衡、网关、Service Mesh Sidecar 和 SDK 都做超时/重试，故障时会出现预算冲突和重试风暴。

## 6. AI Gateway 需要多考虑什么

LLM 流量与普通短 HTTP 请求不同：

- 请求体可能很大，需要按 token/模型而非只按请求数限流；
- TTFT、TPOT、总时长是三个不同 SLO；
- SSE/流式响应要求中间层不错误缓冲；
- 长连接会占用 upstream pool 和网关资源；
- 模型、LoRA、租户、上下文长度和优先级影响路由；
- 重试可能重复昂贵推理，非幂等或已经输出 token 后更危险；
- 日志与 Trace 不能泄露 Prompt、Token 或密钥。

Higress 的 AI Gateway 能力是否适用，应以目标版本支持的协议、策略和插件为准，并用真实 vLLM/SGLang/MindIE 流式请求验证。

## 7. PoC 验收矩阵

不要只压“200 OK QPS”，至少包含：

| 类别 | 场景 |
| --- | --- |
| 路由 | Host/Path/Header、重写、重定向、灰度、冲突规则 |
| 协议 | HTTP/1.1、HTTP/2、gRPC、WebSocket、SSE |
| 安全 | TLS/mTLS、JWT、OIDC、ACL、Secret 轮换、审计 |
| 弹性 | Endpoint 增删、扩缩容、跨区、控制面中断 |
| 失败 | connect reset、首字节慢、半开连接、5xx、限流 |
| 发布 | 新配置校验、灰度、ACK、生效证明、回滚 |
| 性能 | P50/P95/P99、TTFT、吞吐、连接、CPU/内存、成本 |
| 可观测 | request id、route/cluster、attempt、配置版本、Trace |

PoC 结果要包括失败时证据和恢复时间，而不是只有正常流量峰值。

## 8. 决策方法

可以按以下顺序做选择：

1. 仅需少量稳定反代、静态文件和成熟运维：优先评估 Nginx；
2. 自建控制面、需要动态资源和精细 L4/L7 Filter：评估 Envoy；
3. Kubernetes 上需要声明式 API、多注册中心、插件治理和 AI 网关：评估 Higress；
4. 已有成熟 Controller/网关时，先计算迁移收益、协议兼容和人员成本；
5. 任何方案都固定版本做 PoC，并设计控制面不可用时数据面能否继续服务。

这不是永久结论。规模、协议、团队和供应链变化后，应重新评审。

## 9. 验收问题

- Ingress/Gateway API 与 Nginx/Envoy 为什么不在同一层？
- 裸 Envoy 与 Higress 的控制面责任有何不同？
- `kubectl apply` 成功后，还缺哪些数据面生效证据？
- 控制面失联时，已有流量和新配置分别会怎样？
- AI 流量为何不能只用 HTTP QPS 和平均响应时间验收？
- 哪些需求下 Nginx 反而是更合适、更小的系统？

## 10. 参考资料

- [Higress 是什么](https://higress.cn/en/docs/latest/overview/what-is-higress/)
- [Higress 快速开始](https://higress.cn/en/docs/latest/user/quickstart/)
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Gateway API](https://gateway-api.sigs.k8s.io/)
- [Envoy 架构概览](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview)
- [Nginx 官方文档](https://nginx.org/en/docs/)
