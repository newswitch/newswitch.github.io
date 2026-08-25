---
title: "日志、链路追踪与 OpenTelemetry 学习路线"
sidebar_label: "00. 日志、链路追踪与 OpenTelemetry 学习路线"
sidebar_position: 0
description: "从 Logs、Traces、Context 和 OTLP 入门，进阶到 OpenTelemetry Collector、Loki、Tempo、采样、关联查询、容量与生产排障。"
tags: [OpenTelemetry, Loki, Tempo, Jaeger, Logs, Traces]
---

# 日志、链路追踪与 OpenTelemetry 学习路线

日志、指标和 Trace 描述同一系统的不同侧面。OpenTelemetry 负责埋点、上下文传播、收集、处理和导出；Loki、Tempo/Jaeger、Prometheus 等后端负责存储与查询。把 Collector 当成永久存储或把 Loki 当成全文索引系统，都会产生错误架构。

```text
Application/Infrastructure
→ Logs、Metrics、Traces
→ SDK/Agent
→ OTLP
→ OpenTelemetry Collector
→ Loki / Prometheus-compatible Backend / Tempo或Jaeger
→ Grafana
```

## 1. P0：统一证据链

1. [日志、指标、Trace 与一次请求的统一证据链](./01-日志指标Trace与一次请求的统一证据链.md)
2. [OpenTelemetry SDK、OTLP 与 Collector 数据管道](./02-OpenTelemetry-SDK-OTLP与Collector数据管道.md)
3. [Trace、Span、Context、Baggage、Resource 与 Semantic Conventions](./03-Trace-Span-Context-Baggage-Resource与Semantic-Conventions.md)
4. [自动埋点、手工埋点、Context Propagation 与异步任务](./04-自动埋点-手工埋点-Context-Propagation与异步任务.md)
5. [Collector Receiver、Processor、Exporter、Connector 与 Extension](./05-Collector-Receiver-Processor-Exporter-Connector与Extension.md)
6. [结构化日志、时间戳、级别、堆栈、Request ID 与敏感数据](./06-结构化日志-时间戳-级别-堆栈-Request-ID与敏感数据.md)
7. [Loki Label、Stream、Chunk、Index、对象存储与写读路径](./07-Loki-Label-Stream-Chunk-Index-对象存储与写读路径.md)
8. [LogQL Selector、Parser、Filter、Metric Query 与告警](./08-LogQL-Selector-Parser-Filter-Metric-Query与告警.md)
9. [Trace、Span、Status、Event、Link、Head/Tail Sampling 与错误归因](./09-Trace-Span-Status-Event-Link-Head-Tail-Sampling与错误归因.md)
10. [Tempo、Jaeger、对象存储、查询和部署模式](./10-Tempo-Jaeger-对象存储-查询与部署模式.md)

## 2. P1：部署、关联与生产运维

11. [Agent、DaemonSet、Sidecar、Gateway 与分层 Collector 部署](./11-Agent-DaemonSet-Sidecar-Gateway与分层Collector部署.md)
12. [Loki 单体、Simple Scalable、Microservices 与 Kubernetes 部署](./12-Loki单体-Simple-Scalable-Microservices与Kubernetes部署.md)
13. [Tempo/Jaeger 部署、TraceQL、Span Metrics 与 Service Graph](./13-Tempo-Jaeger部署-TraceQL-Span-Metrics与Service-Graph.md)
14. [Metrics、Logs、Traces、Exemplar 与 Profile 关联分析](./14-Metrics-Logs-Traces-Exemplar与Profile关联分析.md)
15. [基数、采样、背压、容量、安全、多租户、升级与故障 Runbook](./15-基数-采样-背压-容量-安全-多租户-升级与故障Runbook.md)

## 3. 学习完成标准

- 能区分 OTel SDK、Collector、协议和存储后端；
- 能让一个 Trace Context 跨 HTTP、gRPC、消息队列和异步任务传播；
- 能设计不会泄露凭据或造成高基数的 Resource/Attribute；
- 能配置 Receiver、Processor、Exporter 和多 Pipeline；
- 能解释 Loki 为什么主要索引低基数 Label 而不全文索引日志正文；
- 能使用 LogQL、TraceQL 或 Jaeger 查询还原故障；
- 能设计 Head/Tail Sampling，保留错误和慢请求；
- 能把 Prometheus Exemplar、日志 Trace ID 和 Tempo Trace 关联；
- 能处理 Collector 背压、Loki 写入失败、查询超时和 Trace 丢失；
- 能规划日志/Trace 容量、保留、多租户和数据脱敏。

## 4. 必做实验

- 为一个 HTTP 服务添加自动埋点和一个自定义 Span；
- 让 Trace Context 跨两个服务和一个消息队列；
- 配置 Collector 的 OTLP Receiver、Batch、Memory Limiter 和两个 Exporter；
- 故意让后端不可用，观察 Collector Queue、Retry 和丢弃；
- 将 Kubernetes 容器日志送入 Loki，并治理高基数 Label；
- 使用 LogQL 从错误日志计算速率；
- 将 Trace 送入 Tempo/Jaeger，定位慢 Span；
- 配置 Tail Sampling 保留错误和高延迟 Trace；
- 从 Prometheus Exemplar 跳转 Trace，再用 Trace ID 查日志；
- 演练对象存储故障、Collector 过载和查询风暴。
