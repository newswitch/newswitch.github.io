---
title: "Kubernetes ServiceMonitor、PodMonitor、Probe 与抓取故障"
sidebar_label: "10. Kubernetes 目标发现与排障"
sidebar_position: 10
description: "从 CR Selector 到 Endpoint 和最终 Target，排查 Kubernetes 中监控对象存在但指标抓不到的问题。"
tags: [Prometheus Operator, ServiceMonitor, PodMonitor, Probe, Kubernetes]
---

# Kubernetes ServiceMonitor、PodMonitor、Probe 与抓取故障

ServiceMonitor 选择 Service，再从对应 EndpointSlice/Endpoints 产生 Target；PodMonitor 直接选择 Pod；Probe 通常驱动 Blackbox Exporter 从外部视角探测目标。

## 1. ServiceMonitor 链路

```text
Prometheus CR的serviceMonitorSelector
→ ServiceMonitor
→ namespaceSelector
→ Service labels
→ Service port名称
→ EndpointSlice中的Pod IP:targetPort
→ /metrics
```

最常见错误是把 `port` 写成容器端口数字，而该字段实际上匹配 Service Port 的名称。Selector 还受 Namespace 和 Helm Release Label 限制。

## 2. 三种对象选择

| 对象 | 适用 |
| --- | --- |
| ServiceMonitor | 稳定服务 Endpoint，最常用 |
| PodMonitor | 无 Service 或需直接按 Pod 抓取 |
| Probe | HTTP/TCP/ICMP/DNS 等黑盒可用性 |

白盒 `/metrics` 成功不代表用户入口可达；Probe 可以验证 DNS、证书、LB 和网关路径，两者应组合。

## 3. 排障顺序

1. `kubectl get prometheus,servicemonitor,podmonitor,probe -A`；
2. 检查 Prometheus CR 的对象 Selector；
3. 检查 Monitor 的 Namespace/Label Selector；
4. 检查 Service Port Name 与 EndpointSlice；
5. 从 Prometheus Pod 内 `curl` Target；
6. 检查 NetworkPolicy、Service Mesh mTLS、Token、CA 和 SAN；
7. 在 Targets 页面看 Discovered Labels、最终 Labels 和 Last Error；
8. 查 Operator Reconcile 错误和生成的配置。

## 4. Label 治理

使用 Relabel 添加 `cluster/namespace/service`，避免把 Pod UID、完整 Annotation 或用户输入带入指标。`sampleLimit`、`targetLimit` 和 Label 限制可作为最后防线，但不能替代正确埋点。

## 5. 抓取安全

为 Kubernetes API 和业务 Endpoint 使用最小权限 ServiceAccount、CA 校验与 Secret 引用。不要在 Monitor CR 中明文写 Token。跨 Namespace 抓取应有显式允许清单和 NetworkPolicy。

## 6. 验收实验

分别制造错误 Port Name、Selector 不匹配、NetworkPolicy 拒绝、证书错误和 Endpoint 超时；为每种故障记录 `kubectl`、Targets 和 Prometheus 日志中的证据。最后用 Probe 验证公网入口，证明白盒与黑盒监控互补。

参考：[Prometheus Operator API](https://prometheus-operator.dev/docs/api-reference/api/)。
