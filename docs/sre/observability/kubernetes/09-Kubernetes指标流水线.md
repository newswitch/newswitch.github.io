---
title: "Kubernetes 指标流水线：Metrics Server、kube-state-metrics、cAdvisor 与 Prometheus"
sidebar_label: "09. Kubernetes 指标流水线"
sidebar_position: 9
description: "从数据源、API、存储与消费方拆解 Kubernetes 指标体系，解释 kubectl top、HPA、对象状态告警和自定义指标的完整路径。"
tags: [Kubernetes, Metrics Server, kube-state-metrics, cAdvisor, Prometheus, HPA]
---

# Kubernetes 指标流水线：Metrics Server、kube-state-metrics、cAdvisor 与 Prometheus

`kubectl top`、HPA 和 Grafana 都在展示“指标”，但它们读取的不是同一套数据。排查监控问题前，先回答四个问题：谁产生数据、谁转换数据、谁保存历史、谁消费数据。

> **版本基线（2026-09）**：Metrics Server 当前仍提供 `metrics.k8s.io/v1beta1`；0.9.x 面向 Kubernetes 1.34+。kube-state-metrics 当前主版本为 2.x，2.20.0 使用 Kubernetes/client-go 1.36。部署时应按集群版本检查各项目的 compatibility matrix，并锁定镜像与 Chart 版本；本文不沿用旧资料中的 Metrics Server 0.3.x 或 kube-state-metrics 1.x 清单。

## 1. 先看完整地图

```text
容器运行时 / cgroup
  → kubelet 采集 CPU、内存等资源使用量
    ├─ /metrics/resource 或 Summary API
    │    → Metrics Server
    │      → API Aggregation Layer
    │        → metrics.k8s.io
    │          → kubectl top、HPA、VPA
    │
    ├─ /metrics、/metrics/cadvisor
    │    → Prometheus
    │      → 历史查询、告警、Grafana、容量分析
    │
Kubernetes API 对象
  → kube-state-metrics
    → /metrics
      → Prometheus
        → Pod/Deployment/Node/PVC 等对象状态告警

Prometheus
  → Prometheus Adapter
    → custom.metrics.k8s.io / external.metrics.k8s.io
      → HPA 按 QPS、队列长度等扩缩容
```

这里没有一个组件能替代全部其他组件：

| 组件 | 主要输入 | 主要输出 | 保存历史 | 典型消费者 |
| --- | --- | --- | --- | --- |
| kubelet/cAdvisor | cgroup、容器运行时、节点 | Prometheus 指标、资源指标 | 否 | Metrics Server、Prometheus |
| Metrics Server | 各节点 kubelet | Resource Metrics API | 否，只保留最新值 | `kubectl top`、HPA、VPA |
| kube-state-metrics | API Server 中的 Kubernetes 对象 | Prometheus 文本指标 | 否 | Prometheus |
| Prometheus | 各类 `/metrics` 端点 | PromQL、规则、Remote Write | 是 | Grafana、Alertmanager、Adapter |
| Prometheus Adapter | Prometheus 查询结果 | Custom/External Metrics API | 通常不负责长期存储 | HPA |

## 2. kubelet 与 cAdvisor：资源数据从哪里来

Linux 内核通过 cgroup 记录进程组的 CPU 时间、内存、I/O 等统计。容器运行时创建容器时把进程放入对应 cgroup，kubelet 再汇总节点、Pod 和容器层面的资源数据。

常见端点不能混为一谈：

| 端点 | 内容 | 常见用途 |
| --- | --- | --- |
| kubelet `/metrics` | kubelet 自身运行指标 | kubelet 请求、PLEG、Pod 启动时延 |
| kubelet `/metrics/resource` | 精简的节点和容器资源指标 | Metrics Server、资源监控 |
| kubelet `/metrics/cadvisor` | 较完整的容器资源序列 | Prometheus 容器监控 |
| kubelet `/stats/summary` | 汇总后的资源统计 JSON | 兼容性链路、诊断 |

`container_cpu_usage_seconds_total` 是累计 CPU 时间的 Counter，不是“当前 CPU 百分比”。需要对时间窗口求速率：

```promql
sum by (namespace, pod) (
  rate(container_cpu_usage_seconds_total{container!="",image!=""}[5m])
)
```

结果为 `1` 大致表示平均使用一个 CPU Core；在四核节点上它不是自动变成 25%。分母取节点核数、容器 limit 还是 request，代表三种不同问题，不能混用。

## 3. Metrics Server：服务资源指标 API

Metrics Server 周期性访问各节点 kubelet，聚合最新的 CPU 和内存使用量，再通过 API Aggregation Layer 注册为：

```text
/apis/metrics.k8s.io/v1beta1/nodes
/apis/metrics.k8s.io/v1beta1/pods
```

查看原始返回值：

```bash
kubectl get --raw '/apis/metrics.k8s.io/v1beta1/nodes' | jq .
kubectl get --raw '/apis/metrics.k8s.io/v1beta1/namespaces/default/pods' | jq .
```

简化输出类似：

```json
{
  "kind": "NodeMetricsList",
  "items": [
    {
      "metadata": {"name": "worker-01"},
      "timestamp": "2026-09-22T08:00:15Z",
      "window": "15s",
      "usage": {"cpu": "812345678n", "memory": "6245120Ki"}
    }
  ]
}
```

`kubectl top` 只是该 API 的客户端：

```bash
kubectl top node
kubectl top pod -A --containers
```

### 3.1 为什么它不适合做长期监控

Metrics Server 的目标是为 Kubernetes 自动扩缩容提供轻量、及时的资源样本，而不是：

- 保存数天或数月历史；
- 提供任意标签聚合和复杂查询；
- 作为计费依据；
- 代替 Prometheus 告警；
- 提供应用 QPS、错误率等业务指标。

因此“`kubectl top` 有值”只能证明资源指标链路当前可用，不能证明 Prometheus、告警或历史数据正常。

### 3.2 HPA 如何使用 CPU 指标

当 HPA 配置 `averageUtilization: 70` 时，它比较的是使用量与 **CPU request**，不是与 CPU limit 或节点总核数比较。简化计算为：

```text
当前平均利用率 = 各 Pod CPU 使用量 / 各 Pod CPU request
期望副本数 ≈ ceil(当前副本数 × 当前值 / 目标值)
```

容器没有设置 CPU request 时，按利用率计算的 HPA 可能无法为该 Pod 得出有效结果。排查时同时看：

```bash
kubectl describe hpa <name> -n <namespace>
kubectl top pod -n <namespace>
kubectl get pod <pod> -n <namespace> -o jsonpath='{.spec.containers[*].resources.requests.cpu}'
```

## 4. kube-state-metrics：把对象状态翻译成指标

kube-state-metrics（KSM）通过 List/Watch 读取 API Server 中的对象，把 `spec`、`status`、label、annotation 等字段转换成 Prometheus 指标。它不进入 Pod，也不读取 cgroup。

典型指标：

```text
kube_deployment_spec_replicas
kube_deployment_status_replicas_available
kube_pod_status_phase
kube_pod_container_status_waiting_reason
kube_node_status_condition
kube_persistentvolumeclaim_status_phase
```

例如判断 Deployment 期望副本和可用副本的差距：

```promql
kube_deployment_spec_replicas
- on (namespace, deployment)
kube_deployment_status_replicas_available
```

判断持续处于 `Pending` 的 Pod：

```promql
max_over_time(
  kube_pod_status_phase{phase="Pending"}[10m]
) == 1
```

### 4.1 为什么 KSM 与 kubectl 显示可能不同

KSM 尽量直接暴露 API 对象的原始状态；`kubectl` 可能组合多个字段并应用展示规则。出现差异时应检查：

1. Prometheus 样本时间是否新鲜；
2. KSM 的 List/Watch 是否断开或被限流；
3. 查询是否遗漏 `namespace`、`uid` 等匹配标签；
4. 指标是否处于 experimental、deprecated 或需要 opt-in；
5. `kubectl` 展示值到底由哪些字段计算得出。

KSM 不是事件数据库。对象被删除后，相应时间序列会停止产生新样本；历史是否保留由 Prometheus retention 决定。

## 5. Prometheus 与 Adapter：让 HPA 使用业务指标

Prometheus 负责抓取、存储和查询时间序列。Prometheus Adapter 把选定的 PromQL 结果映射到 Kubernetes 指标 API：

```text
Prometheus 中的 http_requests_total
  → rate(...[2m])
  → Prometheus Adapter 映射
  → custom.metrics.k8s.io
  → HPA 读取 pods/http_requests_per_second
```

三类 API 的边界：

| API | 示例 | 常见来源 |
| --- | --- | --- |
| `metrics.k8s.io` | Pod CPU、内存 | Metrics Server |
| `custom.metrics.k8s.io` | 每个 Pod 的 QPS | Prometheus Adapter |
| `external.metrics.k8s.io` | Kafka Lag、云队列深度 | Adapter、KEDA 等 |

检查聚合 API 是否注册：

```bash
kubectl get apiservice | grep metrics
kubectl get --raw '/apis/custom.metrics.k8s.io/v1beta1' | jq .
kubectl get --raw '/apis/external.metrics.k8s.io/v1beta1' | jq .
```

Adapter 不是 Prometheus 的替代品。它解决的是 API 格式转换和资源映射，查询数据仍来自后端指标系统。

## 6. 部署与验收

Metrics Server 常见 Helm 部署方式：

```bash
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
helm search repo metrics-server/metrics-server --versions | head

# 从上面的兼容版本中选择并锁定，不要直接跟随 latest
METRICS_SERVER_CHART_VERSION='x.y.z'
helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --version "${METRICS_SERVER_CHART_VERSION}"
```

生产环境不要让流水线始终跟随 `latest`。Chart 版本和 Metrics Server 应用版本不是同一个版本号，应通过 Chart 元数据确认其 `appVersion`。

不要因为证书问题就长期保留 `--kubelet-insecure-tls`。生产环境应让 kubelet serving certificate 具有可信 CA 和正确 SAN。部署后分层验收：

```bash
kubectl get deploy,pod,svc,endpoints -n kube-system -l k8s-app=metrics-server
kubectl get apiservice v1beta1.metrics.k8s.io -o yaml
kubectl get --raw '/apis/metrics.k8s.io/v1beta1/nodes' | jq '.items[].metadata.name'
kubectl top node
```

kube-state-metrics 通常随 kube-prometheus-stack 部署，也可以独立安装。验收重点不是 Pod 为 `Running`，而是目标被抓取且关键指标存在：

```promql
up{job=~".*kube-state-metrics.*"}
count(kube_node_info)
count(kube_pod_info)
```

## 7. 常见故障的分层排查

### 7.1 `kubectl top` 返回 Metrics API not available

```text
kubectl top
  → kube-apiserver
  → APIService v1beta1.metrics.k8s.io
  → metrics-server Service/Endpoint
  → Metrics Server Pod
  → kubelet:10250
```

按链路检查：

```bash
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl describe apiservice v1beta1.metrics.k8s.io
kubectl get endpoints -n kube-system metrics-server
kubectl logs -n kube-system deploy/metrics-server --tail=200
```

常见原因包括聚合层不可用、Service 无 Endpoint、控制面到 Pod 网络不通、Metrics Server 到 kubelet 10250 不通、kubelet 证书不受信任、Node 地址选择错误以及 kubelet Webhook 认证/授权未开启。

### 7.2 `kubectl top` 正常，但 Grafana 没有容器指标

这说明 Metrics Server 链路正常，不代表 Prometheus 抓取链路正常。检查：

```promql
up{job=~".*kubelet.*"}
count(container_cpu_usage_seconds_total{container!=""})
```

再检查 ServiceMonitor、认证、kubelet `/metrics/cadvisor` 访问权限、标签 relabel 和查询时间范围。

### 7.3 CPU 有数据，但 Pod 状态告警全部消失

容器资源指标和对象状态来自不同路径。检查 KSM：

```promql
up{job=~".*kube-state-metrics.*"}
count(kube_pod_status_phase)
```

同时查看 KSM 日志、RBAC、API Server 限流和版本兼容。不要通过重启 Metrics Server 处理 KSM 问题。

### 7.4 HPA 显示 `<unknown>`

依次检查：

1. HPA 引用的是 Resource、Custom 还是 External metric；
2. 对应 APIService 是否 Available；
3. 原始 API 是否返回目标对象；
4. Pod selector 和 Adapter 资源映射是否匹配；
5. 指标是否新鲜、单位是否正确；
6. Resource utilization 场景是否设置 request。

## 8. 容量、基数与安全

- KSM 的 label/annotation allowlist 会把对象字段变成指标标签，范围过大可造成高基数。
- 容器指标保留 `pod`、`container`、`image` 等标签时，要评估短生命周期 Pod 带来的时间序列 churn。
- Prometheus 抓取间隔决定样本量，Metrics Server 的采样周期不能代替 Prometheus 的容量计算。
- `/metrics` 可能暴露对象名、namespace、镜像和业务标签，应限制网络访问并使用最小 RBAC。
- HPA 控制链应监控 API 可用性、样本新鲜度和扩缩容事件，不能只监控 HPA 对象存在。

## 9. 一张表回答常见问题

| 问题 | 首先检查 |
| --- | --- |
| 为什么 `kubectl top` 没数据 | Metrics Server、APIService、kubelet 10250 |
| 为什么 HPA 看不到 CPU | Resource Metrics API、CPU request |
| 为什么 Deployment 不可用没有指标 | kube-state-metrics、Prometheus 抓取 |
| 为什么 Grafana 没有历史 | Prometheus 存储和查询，不是 Metrics Server |
| 为什么 HPA 看不到 QPS | Prometheus Adapter/KEDA 与 Custom/External Metrics API |
| 为什么 KSM 与 kubectl 不一致 | 样本新鲜度、字段语义、kubectl 展示逻辑 |

## 10. 练习与答案

**问题 1：Metrics Server 已停止，Prometheus 的历史 CPU 图会立即消失吗？**

不会。Prometheus 通常直接抓取 kubelet/cAdvisor，已有历史仍保存在 TSDB 中；受影响的是 `metrics.k8s.io`、`kubectl top` 和依赖资源指标的扩缩容链路。

**问题 2：kube-state-metrics 能否告诉你容器当前使用 500 MiB 内存？**

不能。它读取 Kubernetes API 对象状态，不读取 cgroup。容器实际内存应从 kubelet/cAdvisor 资源指标获取；KSM 可以提供容器 request、limit、状态和重启次数等对象字段。

**问题 3：为什么设置 CPU limit 但没有 request 时，CPU 利用率型 HPA 仍可能异常？**

因为 `averageUtilization` 以 request 为分母。limit 是运行时上限，不是 HPA 利用率目标的基准。

**问题 4：Prometheus Adapter 查询失败时，应不应该重启 HPA Controller？**

不应先重启。先验证 Custom/External Metrics API、Adapter 日志、PromQL、资源标签映射和样本新鲜度。HPA Controller 只是消费者。

## 11. 参考资料

- [Metrics Server](https://github.com/kubernetes-sigs/metrics-server)
- [Metrics Server Compatibility Matrix](https://github.com/kubernetes-sigs/metrics-server#compatibility-matrix)
- [kube-state-metrics](https://github.com/kubernetes/kube-state-metrics)
- [Resource Metrics Pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)
- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Prometheus Adapter](https://github.com/kubernetes-sigs/prometheus-adapter)
