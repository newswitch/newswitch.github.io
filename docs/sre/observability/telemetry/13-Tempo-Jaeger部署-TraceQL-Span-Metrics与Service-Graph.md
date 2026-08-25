---
title: "Tempo/Jaeger 部署、TraceQL、Span Metrics 与 Service Graph"
sidebar_label: "13. Trace 后端部署与派生指标"
sidebar_position: 13
description: "部署 Trace 后端，掌握 TraceQL 查询，并从 Span 派生 RED 指标和服务依赖图。"
tags: [Tempo, Jaeger, TraceQL, Span Metrics, Service Graph]
---

# Tempo/Jaeger 部署、TraceQL、Span Metrics 与 Service Graph

Trace 后端上线前先测量 Spans/s、Trace/s、平均 Span 数、属性大小、保留期和查询模式。单体部署适合学习，生产分布式模式需要对象存储、队列/缓冲和独立读写容量。

## 1. 接入链路

```text
Application
→ OTel Agent/Gateway
→ OTLP/mTLS
→ Tempo Distributor或Jaeger接收层
→ 持久化后端
→ Query/Grafana/UI
```

入口限制请求大小、Span 数和 Tenant；Collector 与后端都启用自监控。直接把公网应用暴露到后端接收口会绕过治理和限流。

## 2. TraceQL

TraceQL 以 Span/Trace 属性、结构和时延表达查询。实际语法按部署版本验证，调试时从服务和时间范围开始，再添加状态、Duration 和属性条件。属性基数越高、范围越大，扫描成本越高。

查询结果应能从慢 Trace 下钻到关键 Span，并关联日志。只依赖搜索所有 Trace 不适合高频 Dashboard，应派生指标。

## 3. Span Metrics

Span Metrics Connector/Metrics Generator 可从 Span 生成请求率、错误率和时延 Histogram：

```text
Span
→ 按service/operation/status聚合
→ Calls Counter + Duration Histogram
→ Prometheus兼容后端
```

维度必须受控，不能加入 Trace ID、用户 ID 或原始 URL。派生指标受 Trace 采样影响；若只有 1% Head Sampling，调用量需要理解采样偏差，不能无条件当真实总量。

## 4. Service Graph

通过 Client/Producer Span 与 Server/Consumer Span 配对构建服务边。时钟漂移、传播断链、Span 丢失和不一致语义会产生未知节点或错误边。服务图是导航工具，不替代 CMDB 和网络事实。

## 5. 高可用与故障

分布式 Tempo 当前版本可能需要 Kafka 兼容写前日志等组件；Jaeger 的高可用取决于 Collector、Query 和存储后端。部署前锁定版本并绘制真实写确认点、缓存窗口和对象存储路径。

## 6. 验收

注入成功、错误、慢请求和消息消费 Trace；用 TraceQL/UI 查到它们；验证 Span Metrics 与应用原生 RED 指标趋势一致；断开 Context，确认 Service Graph 能暴露未知边；阻断对象存储并测恢复。

参考：[Tempo TraceQL](https://grafana.com/docs/tempo/latest/traceql/)、[Jaeger Deployment](https://www.jaegertracing.io/docs/latest/deployment/)。
