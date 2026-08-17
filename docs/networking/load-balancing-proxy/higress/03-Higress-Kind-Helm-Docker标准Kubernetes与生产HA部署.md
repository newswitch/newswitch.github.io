---
title: "Higress Kind、Helm、Docker、标准 Kubernetes 与生产 HA 部署"
sidebar_label: "03. Higress Kind、Helm、Docker、标准 Kubernetes 与生产 HA 部署"
sidebar_position: 3
tags: [Higress, 部署, Helm, Kubernetes, 高可用]
description: "从 Kind/Docker 学习环境到 Helm 标准集群，理解 Higress Controller、Gateway 数据面、Console、服务发现、HA 与升级。"
---

# Higress Kind、Helm、Docker、标准 Kubernetes 与生产 HA 部署

Higress 是控制面加 Envoy 数据面的网关系统。部署成功不能只看一个 Gateway Pod：必须验证 Controller 能读取 Ingress/Gateway API 和服务发现、生成配置并被数据面 ACK，Gateway 能处理真实协议，Console/管理面被安全隔离。

## 1. 组件和责任

不同版本 Chart 名称可能变化，概念职责为：

```text
Kubernetes API / Nacos / DNS
        ↓ watched/resolved by
Higress Controller / config plane
        ↓ dynamic config
Higress Gateway (Envoy data plane)
        ↓
Upstream services / model servers

Console / admin APIs → management plane
```

Gateway 在控制面短暂不可用时通常可继续按最后有效配置转发，但新 Route、Endpoint 和证书不会生效；因此控制面和数据面 SLO 要分开。

## 2. 环境选择

| 环境 | 用途 | 特点 |
| --- | --- | --- |
| Docker 快速体验 | 本机 UI/功能试用 | 生命周期简化，不代表 K8s |
| Kind | 学习 Ingress/Gateway API/Helm | LoadBalancer、存储和网络为本地模拟 |
| 标准 Kubernetes + Helm | 测试/生产 | 完整调度、LB、证书、HA |
| 云厂商集成 | 托管 LB/服务发现 | 需评估供应商差异 |

## 3. Kind 学习环境

先创建支持端口映射的 Kind 集群，安装目标 Higress 固定 Chart 版本。官方 quickstart 的基本结构是：

```bash
helm repo add higress.io https://higress.io/helm-charts
helm repo update
helm show values higress.io/higress --version <fixed-chart-version>
helm template higress higress.io/higress \
  --namespace higress-system \
  --version <fixed-chart-version> > rendered.yaml
```

先审查 `rendered.yaml` 的镜像、RBAC、Service、端口、CRD、Webhook、SecurityContext 和资源，再安装：

```bash
helm upgrade --install higress higress.io/higress \
  --namespace higress-system --create-namespace \
  --version <fixed-chart-version> \
  -f values-lab.yaml
```

Kind 通常没有真实云 LoadBalancer，可用端口映射、NodePort 或 `kubectl port-forward` 做实验。不要把 `EXTERNAL-IP pending` 当作 Higress 故障。

## 4. Docker 快速体验的边界

若目标版本提供 all-in-one Docker/Compose，可用于查看 Console、创建 Route 和转发本机服务。必须固定 release、挂载配置/数据并只绑定 localhost。

它不能证明：

- Kubernetes RBAC/CRD/Webhook 正常；
- 多 Gateway 副本、PDB 和滚动无损；
- LoadBalancer source IP、PROXY protocol 和跨节点流量正确；
- Nacos/Kubernetes Endpoint 动态同步；
- 云磁盘、Secret、cert-manager 和 NetworkPolicy 可用。

## 5. 标准 Kubernetes 生产拓扑

```text
External/Internal LB
  → 3+ Gateway replicas across zones
      → upstream services/model endpoints

2+ Controller replicas (leader election)
Console isolated from public entry
```

副本数要按峰值流量、单 Pod 容量、维护和故障冗余计算，而不是固定“两个就高可用”。Gateway 配置资源 requests/limits、反亲和、TopologySpread、PDB、PriorityClass、HPA 与足够 termination grace。

Controller 的多个副本通常由 leader election 避免重复写控制状态，需验证 leader 切换期间配置更新延迟。

## 6. Helm values 生产清单

显式管理：

- Higress/Chart/Envoy image 的固定版本和 digest；
- Controller/Gateway/Console 副本和资源；
- Gateway Service 类型、externalTrafficPolicy、源 IP 与健康检查；
- Ingress/Gateway API CRD 所有权与升级；
- TLS Secret/cert-manager、mTLS、JWT/OIDC 和管理面认证；
- Wasm 插件来源、签名、OCI digest 和失败策略；
- Nacos/DNS/Kubernetes 服务发现地址与凭据；
- Prometheus、Access Log、Tracing、审计与敏感字段脱敏；
- NetworkPolicy、PodSecurity、只读文件系统和最小 RBAC；
- AI Gateway 模型/Token 限流和流式超时。

values 文件进入 Git，Secret 使用引用，不把明文写进 Helm release history。

## 7. 数据面入口与客户端地址

LoadBalancer 到 Gateway 要验证：

```text
DNS TTL and failover
source IP preservation
TCP keepalive / idle timeout
TLS passthrough or termination ownership
HTTP/2, gRPC, WebSocket, SSE
health check path and port
connection drain on pod termination
```

云 LB 的 idle timeout 若短于 LLM 流式生成或 WebSocket，会出现 Gateway 指标正常但客户端中途断开。

## 8. 服务发现集成

Kubernetes Service/EndpointSlice、Nacos、DNS 等可作为 upstream 来源。每种来源都要记录：

```text
authority → who owns endpoint truth
refresh/push path → when change reaches gateway
cache → behavior during control-plane outage
health → active/passive/application readiness
metadata → zone/weight/protocol mapping
```

一个服务不要同时由两个来源无规则覆盖。部署验收要让 Endpoint 上下线，观察 Controller 的版本和 Gateway 实际 Cluster，而不是只看 Nacos/K8s 控制台。

## 9. 插件供应链

Wasm 插件会运行在请求路径中。生产需固定 OCI digest、签名和 SBOM，限制来源，做资源/超时测试，并规定 fail-open 或 fail-close。

插件发布：

```text
offline scan/test
→ staging replay
→ canary routes/tenants
→ observe latency/error/memory
→ progressive rollout
→ one-click previous digest rollback
```

## 10. 统一验收

1. Controller/Gateway/Console/CRD 版本匹配且 Pods Ready；
2. Helm 渲染清单、镜像 digest 和生效 values 已归档；
3. 创建 Host/Path/Header Route，验证 status 和真实转发；
4. 修改 Endpoint，测配置传播时间和旧连接行为；
5. 验证 TLS、gRPC、WebSocket、SSE/LLM streaming；
6. 故障一个 Gateway、Controller leader、Nacos/上游；
7. 检查 route/cluster/attempt/config version 的日志和指标；
8. 执行 canary、限流、重试、熔断与插件回滚；
9. 容量测试同时覆盖新连接、长连接和配置更新。

## 11. 升级与回滚

核对 Higress、Chart、Kubernetes、Gateway API CRD、Envoy/Wasm ABI 与插件兼容。先备份 CR/values/Secret 引用和 CRD，`helm diff`/模板比较，再 canary Gateway 数据面，最后滚动 Controller。

CRD 升级和控制面升级可能不可简单 Helm rollback。回滚方案要分别覆盖数据面镜像、Controller、Chart values、CRD conversion 和插件 digest，并验证旧控制面能理解当前资源。

## 12. 参考资料

- [Higress 快速开始](https://higress.cn/en/docs/latest/user/quickstart/)
- [Higress Helm Charts](https://github.com/alibaba/higress/tree/main/helm)
- [Higress 部署文档](https://higress.cn/en/docs/latest/ops/deploy-by-helm/)
- [Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/)
