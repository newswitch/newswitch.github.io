---
title: "Tempo、Jaeger、对象存储、查询与部署模式"
sidebar_label: "10. Trace 后端架构与选型"
sidebar_position: 10
description: "比较 Tempo 与 Jaeger 的接入、存储和查询路径，并解释单体与分布式部署模式。"
tags: [Tempo, Jaeger, TraceQL, 对象存储, 分布式追踪]
---

# Tempo、Jaeger、对象存储、查询与部署模式

OpenTelemetry 负责生成和输送 Trace，Tempo/Jaeger 是存储与查询后端。两者都可接收 OTel 数据，但内部组件、索引模型、存储后端和查询语言不同。

## 1. Tempo 数据路径

当前 Tempo 版本的具体组件会演进，主路径可抽象为：

```text
OTel Collector
→ Distributor
→ 近期写入/持久化缓冲
→ Block Builder
→ 对象存储Parquet Block

Query Frontend
→ Querier
→ 近期数据 + 对象存储
→ TraceQL结果
```

生产使用对象存储保存长期 Trace，读写路径可独立扩展。不同 Tempo 版本的单体/微服务模式及是否依赖 Kafka 兼容队列应按目标版本官方架构核对，不能照搬旧配置。

## 2. Jaeger 数据路径

Jaeger 接收 Span，经 Collector 写入配置的存储后端，再由 Query/UI 查询。现代部署可使用 OTLP 接入；存储能力和查询成本取决于所选后端及版本。

## 3. 对比维度

| 维度 | Tempo | Jaeger |
| --- | --- | --- |
| 典型查询 | Trace ID、TraceQL 属性查询 | Trace ID、服务/操作/标签查询 |
| 长期存储 | 面向对象存储 Block | 取决于配置后端 |
| 指标派生 | Metrics Generator/连接器 | 通常结合 OTel/外部指标链路 |
| 生态 | Grafana 深度联动 | 成熟追踪 UI 与 OTel 生态 |

不要只按 UI 选择。要评估 Trace/s、平均 Span 数、属性基数、查询模式、保留、对象存储、Tenant 和团队运维能力。

## 4. 对象存储边界

对象存储不可用时，写路径可缓存多久、近期查询是否可用、历史查询何时失败，取决于后端架构。Bucket Lifecycle、版本、加密、跨区复制和 Compactor/Retention 必须协调，避免绕过后端删除数据。

## 5. 验收

用同一 OTel 流量分别写入测试后端，验证按 Trace ID、服务、错误和时延查询；阻断对象存储，记录写入、近期查询、历史查询和恢复追赶；比较单位 Trace 成本与查询 P99。

参考：[Tempo Architecture](https://grafana.com/docs/tempo/latest/introduction/architecture/)、[Jaeger Architecture](https://www.jaegertracing.io/docs/latest/architecture/)。
