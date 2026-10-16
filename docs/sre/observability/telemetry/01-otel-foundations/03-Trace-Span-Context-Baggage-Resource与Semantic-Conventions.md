---
title: "Trace、Span、Context、Baggage、Resource 与 Semantic Conventions"
sidebar_label: "03. Trace 数据模型与语义"
sidebar_position: 3
description: "从一次分布式请求建立 Trace、Span、Context、Baggage 和 Resource 的数据模型，并解释语义约定、时钟、错误和属性边界。"
tags: [OpenTelemetry, Trace, Span, Context, Baggage, Semantic Conventions]
---

# Trace、Span、Context、Baggage、Resource 与 Semantic Conventions

Trace 不是按时间排序的一组日志，而是一棵由父子关系和 Link 组成的操作图。能否正确还原请求路径，取决于 Span 数据和跨进程 Context 是否完整。

```text
Trace 4bf9...
└─ Span API POST /orders
   ├─ Span SQL INSERT orders
   ├─ Span HTTP inventory/reserve
   │  └─ Span Redis GET stock
   └─ Span publish order-created
      └─ Link → 消费者处理Trace
```

## 1. Trace ID、Span ID 与 Trace Flags

- Trace ID：标识整条 Trace，通常跨进程保持不变；
- Span ID：标识一次操作，每个 Span 独立；
- Parent Span ID：形成父子关系；
- Trace Flags：包含是否采样等标志；
- Trace State：供应商/系统间传递的额外采样状态。

Span ID 相同不是“同一个服务”，Trace ID 相同也不代表所有 Span 已成功上报。某个服务未传播 Context 或 Span 被采样丢弃，Trace 会出现断点。

## 2. Span 的核心字段

| 字段 | 作用 |
| --- | --- |
| Name | 稳定、低基数的操作名 |
| Kind | Server、Client、Producer、Consumer、Internal |
| Start/End Time | 操作时间范围 |
| Attributes | 可检索的键值维度 |
| Events | Span 内关键时刻及其属性 |
| Links | 与非父子 Span Context 建立关系 |
| Status | Unset、Ok、Error |
| Resource | 产生遥测数据的实体属性 |

Span Name 应写 `HTTP POST /orders` 或稳定 RPC 方法，不写 `/orders/884921`、完整 SQL 或异常文本，否则增加存储基数并泄露数据。

## 3. Span Kind 与时间归因

```text
入口服务：SERVER
调用下游：CLIENT
消息发送：PRODUCER
消息消费：CONSUMER
进程内部阶段：INTERNAL
```

Kind 帮助后端区分网络两端和构建服务图。客户端 Span 800ms、服务端 Span 300ms 并不矛盾：差值可能来自 DNS、连接、TLS、代理排队、网络、时钟偏差或下游尚未创建服务端 Span 的阶段。

## 4. Attribute、Event 和 Status

Attribute 描述整个 Span 的稳定特征；Event 表示某个时间点发生的事情，例如异常、重试或锁等待：

```text
Span: POST /orders
Attributes: http.request.method=POST, server.address=api.example.com
Event: exception(time=..., exception.type=TimeoutError)
Status: ERROR
```

记录异常 Event 不会自动把 Status 设为 Error，具体由 Instrumentation 实现和应用逻辑决定。HTTP 404 对客户端 Span 和服务端业务可能具有不同错误语义，应遵循当前 Semantic Conventions，而不是统一将所有非 2xx 标红。

## 5. Resource 与 Span Attribute

Resource 描述产生信号的实体，并通常由同一进程的所有 Span、Metric、Log 共享：

```text
service.name=order-api
service.namespace=commerce
service.version=2026.10.1
deployment.environment.name=prod
k8s.cluster.name=prod-a
k8s.pod.name=order-api-7f...
cloud.region=cn-north-1
```

请求方法属于 Span Attribute，不属于 Resource；服务版本属于 Resource，不应每个 Span 手工重复。`service.name` 缺失或各团队命名不一致，会让服务图和查询聚合失真。

## 6. Context 是进程内载体

OpenTelemetry Context 保存当前活动 Span 等值，并在函数调用、线程、协程或异步任务间传播。它是运行时对象，不等于网络 Header。

```text
当前Context
→ 包含Span Context与Baggage
→ Propagator序列化到HTTP/消息Header
→ 下游提取并创建新Context
```

Context 丢失时，下游仍可能创建 Span，但会变成新的 Root Span。

## 7. W3C Trace Context

常见 Header：

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: vendor=value
```

`traceparent` 包含版本、Trace ID、Parent ID 和 Flags。外部输入是不可信数据：必须限制 Header 大小、拒绝非法格式，并在安全边界决定是否继续外部 Trace 或建立新 Trace/Link。

## 8. Baggage 不是 Span Attribute

Baggage 是随 Context 传播的键值：

```http
baggage: tenant.tier=gold,experiment.id=checkout-v2
```

它不会自动成为 Span Attribute，必须由代码或 Processor 显式读取并写入信号。Baggage 经网络 Header 传播，没有内建完整性保证，可能流向第三方服务；不要放 Token、邮箱和敏感身份，也不要信任客户端提供的权限信息。

## 9. Link 与异步系统

父子关系适合单请求调用链。批处理、消息消费和 Fan-in/Fan-out 可能与多个上游操作相关，应使用 Link：

```text
Producer Span A ─┐
Producer Span B ─┼─ Link → Batch Consumer Span
Producer Span C ─┘
```

强行选择一个 Parent 会丢失其他因果关系。Link 还能表达“重试、补偿或调度任务源自哪个 Context”。

## 10. Semantic Conventions

语义约定统一 Attribute 名称、Span Name、Kind 和状态规则，使不同语言和库的数据可以查询。它们会版本演进，部署时应：

1. 记录 SDK 和 Semantic Convention 版本；
2. 新旧属性并行迁移或在 Collector 规范化；
3. 回归 Dashboard、Sampling Policy 和 TraceQL；
4. 避免团队自行发明同义字段。

`http.method` 与较新的语义字段、旧数据库属性与新字段可能同时存在一段时间，查询要明确兼容窗口。

## 11. 时钟与 Span 时长

Span Duration 通常由同一进程的开始/结束时间计算，相对可靠；跨主机比较绝对时间依赖 NTP/PTP。时钟漂移会造成子 Span 看似早于父 Span、网络耗时为负或日志无法对齐。

观测体系应监控时钟偏差，并保留接收时间与事件时间的区别。

## 12. 练习与答案

**问题：Baggage 中已有 `tenant.id`，后端为什么查不到 Span Attribute？**

答案：Baggage 与 Span Attribute 相互独立，需要 Instrumentation/Processor 显式复制，而且应先做信任和基数审查。

**问题：消息消费者必须是 Producer Span 的 Child 吗？**

答案：不一定。长时间异步、批量消费或多来源场景使用新 Trace 加 Link 通常更准确。

## 13. 参考资料

- [OpenTelemetry Traces](https://opentelemetry.io/docs/concepts/signals/traces/)
- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- [OpenTelemetry Baggage](https://opentelemetry.io/docs/concepts/signals/baggage/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
