---
title: "Metrics、Access Log、Trace、Telemetry、Prometheus、Grafana 与 Kiali"
sidebar_label: "10. Istio 可观测性体系"
sidebar_position: 10
description: "把网格 RED 指标、访问日志和 Trace 与应用信号关联，并治理维度、采样和 Sidecar/Ambient 差异。"
tags: [Istio, Telemetry, Prometheus, Tracing, Kiali]
---

# Metrics、Access Log、Trace、Telemetry、Prometheus、Grafana 与 Kiali

网格遥测描述代理看到的连接和请求，不等于应用业务结果。正确做法是用 Istio RED 指标发现网络层异常，再用应用指标、Trace 和日志确认根因。

## 1. 信号路径

```text
Envoy/ztunnel/waypoint
├─ Metrics → Prometheus → Grafana/Alert
├─ Access Log → Collector/Loki
└─ Trace Span → OTel Collector → Tempo/Jaeger

Kiali ← Prometheus + Istio/Kubernetes配置 + Trace可选
```

Telemetry API 控制指标覆盖、访问日志 Provider 和 Trace Provider。配置作用域可在 Mesh、Namespace、Workload 叠加，变更前检查继承。

## 2. 指标

核心维度包括来源/目标工作负载、服务、响应码、协议和 Reporter。删除不需要的高基数维度，禁止请求 ID、完整 Path 参数和用户 ID。

Sidecar 常从源/目标两侧报告；Ambient ztunnel 与 Waypoint 的 Reporter 和 Span 结构不同，迁移后必须更新查询，避免双计数或漏数。

## 3. Access Log

记录时间、方法、规范化路由、响应码、Flags、上下游地址、Duration、Bytes、mTLS Principal、Trace ID。日志格式结构化并脱敏 Authorization/Cookie。全量成功日志成本高，可对低价值流量采样。

## 4. Trace

代理要接收到并传播 Trace Header 才能关联；应用仍应创建业务 Span。采样率在入口一致配置，避免每层独立决策。网格 Span 数、Sidecar/Ambient 差异和批量消息链路需在容量模型中体现。

## 5. Kiali 边界

Kiali 根据指标和配置展示拓扑与校验，不是数据平面真相源。没有流量或 Prometheus 数据时图为空；边存在只说明观测到流量，不证明业务依赖一定合理。

## 6. SLO 与告警

- Gateway/Service 请求成功率与 P99；
- Upstream Connect Failure、Reset、Timeout；
- mTLS/Authorization 拒绝率；
- xDS 配置同步与 Istiod Push；
- ztunnel/Waypoint/Sidecar 资源和重启；
- 证书剩余时间。

告警链接到具体 Workload 的 Proxy 配置、Trace 和日志，而不是只给一张集群总图。

参考：[Istio Observability](https://istio.io/latest/docs/tasks/observability/)、[Telemetry API](https://istio.io/latest/docs/reference/config/telemetry/)。
