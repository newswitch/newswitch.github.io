---
title: "什么是 Istio?"
sidebar_label: "02. 什么是 Istio?"
sidebar_position: 2
description: "从请求路径理解 Istio 的控制平面、Sidecar 与 Ambient 数据平面，以及流量、安全和可观测能力的真实边界。"
tags: [Kubernetes, 服务网格, PartII, 学习路线]
---

# 什么是 Istio?

Istio 是服务网格实现：应用仍然处理业务协议，网格的数据平面代理负责承载服务间流量，控制平面把服务发现、路由和安全策略翻译成代理可执行的配置。它解决的是“如何统一治理通信”，不是自动修复应用、数据库或网络的一切问题。

## 1. 为什么需要服务网格 {/* #为什么需要服务网格 */}

当数百个服务分别实现重试、证书轮换、鉴权、指标和灰度时，不同语言和团队很难维持一致行为。Istio 把这些横切能力下沉到基础设施：

- 流量：路由、超时、重试、熔断、镜像和灰度；
- 身份：基于工作负载身份签发和轮换证书，建立 mTLS；
- 授权：按身份、命名空间、端口或 HTTP 属性控制访问；
- 观测：代理指标、访问日志和分布式追踪上下文；
- 扩展：Envoy Filter、WasmPlugin 和外部授权服务。

这些能力都有边界。例如重试会放大下游压力，mTLS 不等于业务授权，指标也不能替代应用内部埋点。

## 2. 一次请求经历什么 {/* #一次请求经历什么 */}

经典 Sidecar 模式：

```text
客户端应用
 -> 本机 iptables/透明拦截
 -> 客户端 Envoy
 -> mTLS 网络连接
 -> 服务端 Envoy
 -> 服务端应用
```

Ambient 模式：

```text
客户端工作负载
 -> 节点 ztunnel（L4 安全隧道）
 -> 服务端节点 ztunnel
 -> 服务端工作负载
             \-> Waypoint（需要 L7 路由/策略时）
```

控制平面 `istiod` 监听 Kubernetes Service、EndpointSlice、Gateway API 和 Istio CRD，计算服务发现、路由、安全及证书配置，再通过 xDS/CA 接口下发。控制面不在正常数据包转发热路径中；短时失联时，代理通常继续使用最后一次有效配置，但新服务或新策略不会及时生效。

## 3. Sidecar 与 Ambient {/* #sidecar-与-ambient */}

| 维度 | Sidecar | Ambient |
|---|---|---|
| 数据平面 | 每个 Pod 一个 Envoy | 每节点 ztunnel，按需部署 Waypoint |
| L4 mTLS | Sidecar 执行 | ztunnel 执行 |
| L7 路由和授权 | Sidecar 执行 | Waypoint 执行 |
| 应用侵入 | Pod 注入并重启 | 命名空间/工作负载加入网格，不注入 Sidecar |
| 资源模型 | 随 Pod 数量增长 | 基础 L4 按节点共享，L7 按服务需求配置 |

二者并非简单的“新模式一定更好”。应基于 L7 能力、隔离边界、性能、迁移成本和团队运维能力选择，并在迁移时验证策略绑定方式。

## 4. 安全行为必须说清楚 {/* #安全行为必须说清楚 */}

Istio 不会在安装后自动拒绝全部通信：

- 没有 `AuthorizationPolicy` 时，授权默认是允许；
- mTLS 的服务端默认通常为 `PERMISSIVE`，同时接受 mTLS 与明文；
- 要求只接受网格 mTLS，需要显式配置 `PeerAuthentication` 的 `STRICT`；
- “默认拒绝”是推荐的策略设计模式，需要管理员创建 allow-nothing 与精确 ALLOW 策略；
- Ambient 下 ztunnel 只能执行 L4 条件，HTTP 路径、方法等 L7 策略必须绑定 Waypoint。

最小的命名空间默认拒绝示例：

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-nothing
  namespace: payments
spec: {}
```

该策略会影响业务，必须先盘点真实依赖、DNS、监控、健康检查和网关路径，再逐条建立 ALLOW，并准备回滚。

## 5. 验证而不是只看 CRD {/* #验证而不是只看-crd */}

```bash
istioctl analyze
istioctl proxy-status
istioctl proxy-config clusters <pod> -n <namespace>
istioctl proxy-config routes <pod> -n <namespace>
kubectl get authorizationpolicy,peerauthentication -A
```

Ambient 环境进一步检查：

```bash
istioctl ztunnel-config workloads -n istio-system
kubectl get gateway -A
```

一次策略变更至少验证：允许流量成功、禁止流量失败、证书身份正确、超时/重试没有放大请求、代理指标与应用日志可以关联。

## 6. 常见故障定位 {/* #常见故障定位 */}

| 现象 | 先看什么 | 常见原因 |
|---|---|---|
| 503 UF/UC | Endpoint、cluster、连接日志 | 上游无实例、端口错误、连接失败 |
| 403 RBAC | AuthorizationPolicy、身份 principal | 策略未命中、ServiceAccount 错误 |
| mTLS 握手失败 | PeerAuthentication、证书、trust domain | STRICT/PERMISSIVE 不一致或证书问题 |
| 规则未生效 | `proxy-status`、xDS 同步状态 | 配置拒绝、代理失联、选择器未命中 |
| 延迟升高 | 代理与应用分段延迟、重试次数 | 重试放大、Waypoint/Sidecar 资源不足 |

## 7. 学习完成标准 {/* #学习完成标准 */}

完成本篇后，应能画出 Sidecar 和 Ambient 的请求路径，解释 istiod 不在数据热路径中的原因，区分认证与授权，并能通过 `istioctl` 证明配置是否真正到达数据平面。

## 8. 参考资料 {/* #参考 */}

- [Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/)
- [Istio Ambient Mode](https://istio.io/latest/docs/ambient/)
- [Istio Security Best Practices](https://istio.io/latest/docs/ops/best-practices/security/)
