---
title: "Kubernetes ServiceMonitor、PodMonitor、Probe 与抓取故障"
sidebar_label: "10. Kubernetes 目标发现与排障"
sidebar_position: 10
description: "从 Prometheus CR Selector、Monitor 对象、Kubernetes 发现元数据和 Relabel 跟踪到最终 Target，系统排查指标抓不到的问题。"
tags: [Prometheus Operator, ServiceMonitor, PodMonitor, Probe, Kubernetes]
---

# Kubernetes ServiceMonitor、PodMonitor、Probe 与抓取故障

在 Kubernetes 中，“ServiceMonitor 已创建”只完成了声明。它还要被某个 Prometheus CR 选中，再选择 Service、读取 EndpointSlice、生成发现元数据、执行 Relabel，最终才成为 Target。

## 1. 四层选择链

```text
第1层：Prometheus CR选择ServiceMonitor
第2层：ServiceMonitor选择Namespace中的Service
第3层：Service的Selector形成EndpointSlice
第4层：ServiceMonitor Endpoint配置选择Service Port并生成Target
```

任意一层为空，都可能没有 Target，而且业务 Service 本身仍能正常访问。

## 2. ServiceMonitor 完整示例

业务对象：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
  namespace: production
  labels:
    app: order-api
spec:
  selector:
    app: order-api
  ports:
    - name: metrics
      port: 9090
      targetPort: metrics
```

监控对象：

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: order-api
  namespace: monitoring
  labels:
    monitoring: platform
spec:
  namespaceSelector:
    matchNames: [production]
  selector:
    matchLabels:
      app: order-api
  endpoints:
    - port: metrics
      path: /metrics
      interval: 30s
      scrapeTimeout: 10s
```

`endpoints[].port` 通常匹配 Service Port 的名称 `metrics`，不是容器端口数字。Service 没有对应命名端口时 Monitor 可能存在但生成不了预期 Target。

## 3. Prometheus CR 是否选择 Monitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: platform
  namespace: monitoring
spec:
  serviceMonitorSelector:
    matchLabels:
      monitoring: platform
  serviceMonitorNamespaceSelector:
    matchLabels:
      monitoring-scrape: allowed
```

这里有两类 Namespace：ServiceMonitor 自己所在的 Namespace，以及它通过 `spec.namespaceSelector` 查找 Service 的 Namespace。不要混为一谈。

Helm Chart 常给 Monitor 加 Release Label，并让 Prometheus 只选择相同 Label。手写 ServiceMonitor 若漏掉该 Label，最常见表现就是对象存在、Prometheus 完全看不到。

## 4. Service、EndpointSlice 和 Pod

```bash
kubectl -n production get svc order-api -o yaml
kubectl -n production get endpointslice \
  -l kubernetes.io/service-name=order-api -o yaml
kubectl -n production get pod -l app=order-api -o wide
```

判断：

- Service Selector 是否匹配 Pod Label；
- Pod 是否 Ready，Endpoint Conditions 是否符合预期；
- Service Port Name 和 TargetPort 是否正确；
- Endpoint Address 是 Pod IP 还是其他地址；
- 应用实际监听 `0.0.0.0` 还是只监听 `127.0.0.1`。

Service 能转发业务端口，不代表 Metrics 端口也正确。

## 5. PodMonitor 的路径

PodMonitor 跳过 Service，直接选择 Pod：

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: gpu-exporter
  namespace: monitoring
  labels:
    monitoring: platform
spec:
  namespaceSelector:
    matchNames: [gpu-system]
  selector:
    matchLabels:
      app: gpu-exporter
  podMetricsEndpoints:
    - port: metrics
      path: /metrics
      interval: 30s
```

适用于 DaemonSet、无 Service 的 Pod 或确实需要按 Pod 端口发现的目标。它并不天然比 ServiceMonitor 更稳定；Pod IP 变化和大量短生命周期 Pod 会增加 Target Churn。

## 6. Probe 与 Blackbox Exporter

Probe 通过探测器从外部视角检查 DNS、TCP、HTTP、TLS 或 ICMP：

```text
Prometheus
→ 请求Blackbox Exporter /probe?target=https://api.example.com
→ Exporter从其网络位置访问目标
→ 返回probe_success、DNS/TLS/HTTP各阶段耗时
```

它验证入口路径，而不是抓取应用内部状态。白盒 `up=1` 但公网 Probe 失败时，问题可能在 DNS、Ingress、LB、证书或 NetworkPolicy。

## 7. RBAC 和 Operator 调和

Operator 需要读取 Monitor 对象并生成配置；Prometheus 自身需要访问 Kubernetes API 做服务发现。跨 Namespace 与集群范围发现必须有对应 RBAC。

```bash
kubectl -n monitoring logs deploy/prometheus-operator
kubectl auth can-i list servicemonitors.monitoring.coreos.com \
  --as=system:serviceaccount:monitoring:prometheus-operator -A
kubectl auth can-i list endpointslices.discovery.k8s.io \
  --as=system:serviceaccount:monitoring:prometheus -A
```

权限不足会出现在 Operator/Prometheus 日志，不能靠重复重建 ServiceMonitor 修复。

## 8. 最终配置与发现页面

排障要区分三个状态：

```text
CR声明状态
→ Operator生成的Prometheus配置
→ Prometheus运行时Service Discovery/Targets状态
```

可检查 Prometheus UI：

- Service Discovery：候选目标、Discovered Labels、Target Labels、被删除原因；
- Targets：最终地址、Health、Last Scrape、Duration、Last Error；
- Configuration：当前实际加载配置；
- Status/Runtime：版本和运行参数。

Operator 管理的 Secret 名称属于实现细节，优先使用 UI/API 和 Operator 支持的调试方式，不编写依赖某一版本内部 Secret 名称的脚本。

## 9. 网络、TLS 和认证

从 Prometheus Pod 的网络命名空间测试：

```bash
kubectl -n monitoring exec prometheus-platform-0 -- \
  wget -S -O- http://10.244.2.31:9090/metrics
```

若镜像没有调试工具，使用受控 Ephemeral Container 或同节点调试 Pod。需要检查：

- NetworkPolicy 是否允许 Prometheus Egress 和目标 Ingress；
- Service Mesh mTLS 是否要求 Sidecar/证书；
- HTTPS 的 CA、SAN 和 `serverName`；
- Bearer Token/OAuth2/Basic Auth Secret；
- API Server Proxy 或授权代理是否重写路径；
- 抓取 Body 是否过大、Exporter 是否在 Timeout 内完成。

不要为了临时排障永久关闭证书验证。

## 10. Relabel、Limits 和标签治理

Monitor CR 可把 Kubernetes 元数据映射为 Target Label，但不能无选择复制所有 Pod Label/Annotation。Pod UID、版本哈希、动态租户值会扩大 Series 数。

治理原则：

- 保留 `cluster、namespace、service、job` 等稳定下钻维度；
- 仅显式允许需要的 Pod Label；
- 用 `sampleLimit、targetLimit、labelLimit` 等作为保险丝；
- 对触发限制导致的 Scrape Failure 建告警；
- 统一多个团队的 Label 命名，避免同义不同名。

## 11. 一套不跳层的排障顺序

```bash
kubectl get prometheus,servicemonitor,podmonitor,probe -A
kubectl -n monitoring get servicemonitor order-api -o yaml
kubectl -n production get svc,endpointslice,pod -l app=order-api -o wide
```

1. CRD 与 Operator 是否健康；
2. Prometheus CR 是否选中 Monitor 的 Namespace 和 Label；
3. Monitor 是否选中 Service/Pod；
4. Service Port 与 EndpointSlice 是否正确；
5. Service Discovery 中是否存在候选 Target；
6. Relabel 后是否被保留；
7. 从 Prometheus 网络空间能否连接；
8. HTTP/TLS/认证/格式是否正确；
9. Metric Relabel 和 Limits 是否丢弃样本；
10. 查询是否使用了最终 Label。

## 12. 现象对照

| 现象 | 优先层次 |
| --- | --- |
| ServiceMonitor 不在 Service Discovery | Prometheus CR Selector、Namespace、Operator |
| 有 Discovered Target 但被删除 | Relabel、端口/Annotation 条件 |
| Target `DOWN: context deadline exceeded` | 网络、Exporter 慢、Body 大、Timeout |
| `server returned HTTP status 403` | Auth Proxy、Token、RBAC |
| `x509` 错误 | CA、SAN、Server Name、系统时间 |
| `up=1` 但某指标没有 | Collector、Metric Relabel、Limits、指标改名 |
| Prometheus 抓取成功但用户访问失败 | 需要 Probe 检查完整入口路径 |

## 13. 故障实验与答案

分别制造：错误 Monitor Label、错误 Service Port Name、空 EndpointSlice、NetworkPolicy 拒绝、证书 SAN 错误、Exporter 超时和 Metric Relabel Drop。每个实验保存 CR、Discovered Labels、Targets Last Error、网络测试和日志。

**问题：ServiceMonitor 在 `monitoring`，业务 Service 在 `production`，可以抓吗？**

答案：可以，但 Prometheus 必须能选择该 ServiceMonitor，ServiceMonitor 的 Namespace Selector 必须允许 `production`，并且 RBAC 和网络策略允许发现与访问。

**问题：Pod IP 直连 `/metrics` 成功，为什么 Target 仍 Down？**

答案：Prometheus 可能使用不同地址、Scheme、Path、认证和网络命名空间；还可能在格式解析或 Limits 阶段失败。

## 14. 参考资料

- [Prometheus Operator API](https://prometheus-operator.dev/docs/api-reference/api/)
- [Prometheus Operator Getting Started](https://prometheus-operator.dev/docs/getting-started/introduction/)
- [Prometheus Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
