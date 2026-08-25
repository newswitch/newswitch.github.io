---
title: "Agent、DaemonSet、Sidecar、Gateway 与分层 Collector 部署"
sidebar_label: "11. Collector 部署拓扑"
sidebar_position: 11
description: "比较 Collector 贴近工作负载和集中网关两类模式，设计 Kubernetes 分层遥测管道。"
tags: [OpenTelemetry Collector, Agent, DaemonSet, Sidecar, Gateway]
---

# Agent、DaemonSet、Sidecar、Gateway 与分层 Collector 部署

Collector 放在哪里决定故障域、网络跳数、元数据获取、资源隔离和采样能力。大型集群通常采用 Agent + Gateway 分层，而不是让所有 SDK 直接跨集群写后端。

## 1. 部署模式

| 模式 | 优点 | 代价 |
| --- | --- | --- |
| Host Agent/DaemonSet | 接近容器日志和主机信号、网络短 | 每节点资源开销 |
| Sidecar | 与单应用隔离、配置可定制 | Pod 资源和运维数量大 |
| Gateway/Deployment | 集中处理、Tail Sampling、统一出口 | 需要负载均衡和容量保护 |
| Stateful/持久队列 | 可使用稳定存储与分片 | 复杂度更高 |

## 2. 推荐分层

```text
Application SDK
→ Node Agent：接收、补K8s元数据、轻量过滤/批处理
→ Regional Gateway：认证、路由、Tail Sampling、队列
→ Loki/Tempo/Metric Backend
```

Agent 处理与节点相关的日志文件和 Metadata；Gateway 做需要全局视角或集中凭据的处理。不要在两层重复采样、重复添加同一属性或形成循环 Export。

## 3. Kubernetes 设计

- DaemonSet 读取容器日志需要受控 HostPath 和最小权限；
- 使用 Downward API/Kubernetes Attributes 补充 Metadata；
- Gateway 使用 Service 和多副本，按 Trace ID 一致性路由 Tail Sampling；
- 设置 Requests/Limits、PDB、拓扑分散和 HPA；
- OTLP 端口只向需要的 Namespace 开放；
- Backend 凭据集中放在 Gateway Secret。

## 4. 背压边界

后端慢时 Gateway 队列增长，随后 Memory Limiter 拒绝，上游 Agent/SDK 也会重试或丢弃。必须明确每一级最大缓冲时间，防止所有层都设置大重试导致雪崩。

## 5. 容量

分别按 Logs bytes/s、Spans/s、Metrics samples/s 测量。CPU 开销与解析、压缩、正则、采样和 Exporter 数有关；网络按原始与压缩后流量规划。HPA 使用队列长度、接收速率和 CPU 组合，而不是只看 CPU。

## 6. 故障演练

删除一个 Agent、隔离 Gateway、让后端返回 429/5xx、重启带/不带持久队列的实例，核对丢失窗口、重试、内存和恢复追赶。最终确认遥测故障不会拖垮业务线程。

参考：[OpenTelemetry Collector Deployment](https://opentelemetry.io/docs/collector/deployment/)、[Agent Pattern](https://opentelemetry.io/docs/collector/deploy/agent/)。
