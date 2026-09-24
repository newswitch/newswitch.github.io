---
title: "Ingress 控制器"
sidebar_label: "08. Ingress 控制器"
sidebar_position: 8
description: "区分 Ingress API、IngressClass 与控制器实现，理解多控制器接管、生命周期、选型、迁移和故障排查。"
tags: [Kubernetes, Ingress, IngressClass, Gateway API, 控制器]
---

# Ingress 控制器

创建 Ingress 对象不会自动生成代理配置。必须有某个 Controller 观察它、校验它，再把规则转换成 Nginx、Envoy、HAProxy、云负载均衡器或其他数据面的配置。

```text
Ingress / IngressClass
  → API Server
    → Ingress Controller List/Watch
      → 校验、合并与生成配置
        → Data Plane reload / dynamic update
          → LoadBalancer / NodePort / HostNetwork 接收流量
```

## 1. API、控制器和数据面

| 层 | 典型对象 | 职责 |
| --- | --- | --- |
| Kubernetes API | Ingress、IngressClass、Service、EndpointSlice、Secret | 保存期望状态和后端信息 |
| Controller | controller Deployment/Pod | Watch 对象、计算配置、更新 status |
| Data Plane | Nginx、Envoy、HAProxy、云 LB | 真正监听端口并转发请求 |

有的产品把 Controller 与数据面放在同一个 Pod，有的 Controller 只调用云 API 创建外部负载均衡器。排障时不能只看到 Ingress YAML 正确就停止。

## 2. Kubernetes 没有默认内置实现

Kubernetes 定义 Ingress API，但不会随控制面自动安装一个通用 Ingress Controller。各集群发行版、云平台或平台团队需要选择具体实现。

常见类别：

| 类别 | 示例 | 选择重点 |
| --- | --- | --- |
| 云厂商控制器 | AWS Load Balancer Controller、GKE Ingress、各云托管插件 | VPC/LB 集成、配额、成本、区域能力 |
| 网关/代理控制器 | Traefik、Kong、APISIX、HAProxy、Contour | 路由能力、插件、动态配置、社区状态 |
| Service Mesh 网关 | Istio Gateway | 与 Mesh 身份、策略和遥测的集成 |
| 厂商 Nginx 实现 | F5 NGINX Ingress Controller、云厂商 Nginx 插件 | 许可、注解兼容性、维护周期 |
| Gateway API 实现 | Envoy Gateway、NGINX Gateway Fabric、Istio、Cilium 等 | Conformance、Policy 扩展和迁移成本 |

控制器名字相似不代表来自同一项目。例如社区 `kubernetes/ingress-nginx`、F5 NGINX Ingress Controller 和云厂商 Nginx 插件是不同产品，注解、镜像和支持周期可能不同。

## 3. 社区 ingress-nginx 的退役边界

社区 `kubernetes/ingress-nginx` 已于 **2026 年 3 月**停止维护。现有工作负载不会被自动删除，历史镜像和 Helm Chart 也可能仍可下载，但之后没有新版本、缺陷修复或安全更新。

必须准确理解：

- 退役的是该社区 Controller，不是 Kubernetes Ingress API；
- 退役不自动代表厂商维护的 Nginx Controller 同时停止支持；
- 继续运行旧实例的风险会随时间上升，尤其是公网入口和允许 snippet 的多租户集群；
- 替代方案通常不是注解级一比一兼容，需要行为测试。

识别是否使用社区实现：

```bash
kubectl get pods -A \
  -l app.kubernetes.io/name=ingress-nginx \
  -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,IMAGE:.spec.containers[0].image
```

还应检查 Helm release、镜像仓库、Deployment 参数和 `IngressClass.spec.controller`，因为团队可能修改过标签。

## 4. IngressClass 如何决定由谁接管

控制器通常只处理与自身 class 匹配的 Ingress：

```yaml
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: public-gateway
spec:
  controller: example.com/public-ingress-controller
```

Ingress 显式引用：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: shop
spec:
  ingressClassName: public-gateway
  rules:
  - host: shop.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web
            port:
              number: 8080
```

`IngressClass.spec.controller` 是控制器身份，不是 Deployment 名称。具体实现还可能通过启动参数限制 watched class、namespace 或是否接管无 class 的对象。

## 5. 多控制器共存

典型设计：

```text
public IngressClass
  → 公网 LoadBalancer
  → WAF、严格 TLS、有限注解

internal IngressClass
  → 内网 LoadBalancer
  → 企业 DNS、内部证书

legacy IngressClass
  → 迁移期间保留的旧入口
```

为默认 class 添加：

```yaml
metadata:
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
```

集群中不应存在多个默认 IngressClass。无 class Ingress 的实际接管行为还取决于控制器参数，因此生产规范应要求显式填写 `ingressClassName`。

验收：

```bash
kubectl get ingressclass -o yaml
kubectl get ingress -A \
  -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,CLASS:.spec.ingressClassName,ADDRESS:.status.loadBalancer.ingress[*].ip
kubectl get events -A --field-selector involvedObject.kind=Ingress
```

## 6. 从对象到代理配置

Controller 的一次协调通常包括：

1. Watch Ingress、IngressClass、Service、EndpointSlice 和 TLS Secret；
2. 过滤不属于自己的对象；
3. 校验 host、path、backend、annotation 和跨 namespace 引用；
4. 合并多个 Ingress，处理同域名、同路径冲突；
5. 生成代理配置或调用云 API；
6. reload 或动态下发；
7. 更新 Ingress status 和事件；
8. 暴露配置成功/失败指标。

Controller Pod 为 `Running` 不表示最后一次配置已成功生效。生成文件错误、reload 失败、云 API 限流和 Secret 不合法都可能让数据面继续使用旧配置。

## 7. 注解为什么会形成迁移成本

标准 Ingress API 表达能力有限，大量高级行为落在实现特有注解中：

```text
rewrite
timeout / retry
rate limit
authentication
CORS
canary
mirror
source range
raw snippet
```

相同注解名在不同版本中也可能语义变化。迁移前导出清单：

```bash
kubectl get ingress -A -o json \
  | jq -r '.items[] | [.metadata.namespace,.metadata.name,((.metadata.annotations // {})|keys|join(","))] | @tsv'
```

按“标准字段—Gateway API Filter—实现 Policy—需要重构”分类，而不是逐个字符串替换。

## 8. 选型方法

| 维度 | 应回答的问题 |
| --- | --- |
| 生命周期 | 项目是否仍维护，安全问题由谁响应 |
| API | 支持 Ingress、Gateway API 哪些版本和 Conformance Profile |
| 数据面 | Nginx、Envoy、HAProxy、云 LB，reload 还是动态下发 |
| 功能 | TLS、gRPC、WebSocket、流式、重试、镜像、鉴权、WAF |
| 多租户 | snippet、跨 namespace 引用、Secret 和 Policy 如何授权 |
| 扩展 | 标准 Filter 不足时使用何种 Policy/插件 |
| 可观测 | 指标、访问日志、Trace、配置 dump、状态 Condition |
| 性能 | QPS、连接、TLS、配置规模和 reload 抖动 |
| 运维 | 升级、回滚、证书、灰度和灾备方法 |

“功能最多”不是唯一标准。公网入口尤其要优先考虑维护状态、安全边界和升级能力。

## 9. 故障排查路径

```text
DNS / LoadBalancer
→ Controller Service / listener
→ IngressClass 是否匹配
→ Ingress 是否被 Accepted
→ 生成配置是否成功
→ TLS Secret
→ Service port
→ EndpointSlice ready endpoint
→ Pod 应用
```

基础命令：

```bash
kubectl describe ingress <name> -n <namespace>
kubectl get ingressclass
kubectl get svc,endpointslice -n <namespace>
kubectl get events -n <namespace> --sort-by=.lastTimestamp
kubectl logs -n <controller-namespace> deploy/<controller> --since=20m
```

典型判断：

| 现象 | 更可能的层 |
| --- | --- |
| Ingress 一直没有 address/status | class、Controller 或云 LB 调谐 |
| Controller 日志显示配置校验失败 | 注解、路径、Secret、同域名冲突 |
| 默认 404 | Host/Path 未匹配或请求进入错误 Controller |
| 502/503 | Service 端口、EndpointSlice、后端协议或健康状态 |
| HTTPS 握手失败 | 证书、SNI、Secret、TLS listener |
| 修改后仍是旧行为 | reload 失败、访问了另一入口、缓存或多控制器冲突 |

## 10. 迁移到 Gateway API

迁移时同时运行旧、新入口，通过 canary DNS、独立域名或小比例流量验证：

```text
盘点 Ingress + annotation + Secret + LB
→ 选择受维护且通过所需 Conformance 的 Gateway 实现
→ 创建 GatewayClass/Gateway
→ 转换 HTTPRoute
→ 为扩展功能选择标准 Filter 或 Policy
→ 回归 TLS、Header、重写、超时、长连接和客户端 IP
→ 灰度流量
→ 观察错误率与延迟
→ 保留可执行回滚
→ 下线旧 Controller
```

Ingress2Gateway 可辅助转换资源，但不能替代实现特有注解的语义审计。

## 11. 练习与答案

**问题 1：Ingress 已创建且 YAML 正确，为什么没有流量？**

Ingress 只是期望状态。还需要匹配的 Controller、可达的数据面入口、正确 Service/EndpointSlice 和成功加载的配置。

**问题 2：社区 ingress-nginx 退役是否意味着所有 Ingress 明天都会失效？**

不会。已有软件仍可运行，Ingress API 也没有因此删除。风险是社区实现不再获得修复和安全更新，应规划迁移。

**问题 3：两个 Controller 都处理无 class 的 Ingress 会怎样？**

可能同时生成入口、反复更新 status 或产生不一致行为。应显式 class，并检查 Controller 的 watch 参数。

**问题 4：为什么从 ingress-nginx 迁到另一个 Nginx Controller 仍要回归测试？**

它们不是同一实现。注解、默认值、路径匹配、真实 IP、重试、TLS 和 reload 行为都可能不同。

## 12. 参考资料

- [Ingress Controllers](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/)
- [Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [Gateway API](https://gateway-api.sigs.k8s.io/)
- [Ingress2Gateway](https://github.com/kubernetes-sigs/ingress2gateway)
- [Ingress](../../../networking/kubernetes/service-routing/04-Ingress.md)
- [迁移到 Gateway API](../../../networking/kubernetes/service-routing/07-迁移到Gateway-API.md)
