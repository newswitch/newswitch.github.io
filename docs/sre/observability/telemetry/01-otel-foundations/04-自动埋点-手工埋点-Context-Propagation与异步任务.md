---
title: "自动埋点、手工埋点、Context Propagation 与异步任务"
sidebar_label: "04. 埋点与上下文传播"
sidebar_position: 4
description: "从启动自动探针到手工业务 Span，解释 HTTP、gRPC、消息队列、线程、协程和批任务中的 Context 传播、重复埋点与断链排查。"
tags: [OpenTelemetry, Auto Instrumentation, Context Propagation, Async]
---

# 自动埋点、手工埋点、Context Propagation 与异步任务

自动埋点解决通用框架边界，手工埋点补充业务语义。两者都依赖正确的 Context 传播；如果只看到大量 Span，却无法组成完整 Trace，问题通常不在后端存储。

## 1. 埋点数据路径

```text
应用启动
→ 加载SDK与Resource
→ Instrumentation拦截框架调用
→ 从当前Context创建Span
→ 注入/提取远程Context
→ Span Processor批处理
→ OTLP Exporter
→ Collector
```

应用进程退出前要给 Batch Span Processor 留出 Flush 时间，否则短任务最后一批 Span 可能丢失。

## 2. 自动埋点能做什么

常见自动覆盖：

- HTTP Server/Client、gRPC；
- 数据库驱动、Redis；
- 消息生产/消费框架；
- Web 框架和运行时指标；
- 日志 Trace ID 注入。

优点是低改造和跨服务一致性；边界是看不到“库存校验、模型排队、批次合并”这类业务阶段，也可能因框架/探针版本不兼容改变行为。

## 3. 手工 Span 的原则

```text
需要手工埋点：
耗时明显的业务阶段
跨队列/线程的关键任务
调用链中无法自动识别的库
需要独立归因和错误状态的操作
```

不要给每个函数创建 Span。过细 Span 增加 CPU、网络和存储，Trace 时间线反而难读。Span Name 使用稳定操作名，动态值放受控 Attribute。

伪代码：

```python
with tracer.start_as_current_span("inventory.reserve") as span:
    span.set_attribute("inventory.warehouse.region", region)
    try:
        reserve()
    except TimeoutError as exc:
        span.record_exception(exc)
        span.set_status(Status(StatusCode.ERROR))
        raise
```

异常必须继续抛出或按业务处理，埋点不能改变应用控制流。

## 4. HTTP 与 gRPC 传播

客户端从当前 Context 生成 Header，下游服务端提取：

```text
Client Span
→ inject(traceparent/tracestate/baggage)
→ 网络/代理
→ extract(headers)
→ Server Span
```

代理、API Gateway 和 Service Mesh 可能修改或丢弃 Header。需要明确 Header Allowlist、大小限制、跨信任域策略和是否保留外部 Trace。

gRPC Metadata 同样需要传播。重试时每次尝试可以建 Client Span/Event，并由一个逻辑调用 Span 汇总，避免无法区分一次调用与三次网络尝试。

## 5. 线程、协程和 Callback

线程池/协程调度可能丢失语言运行时的当前 Context：

```text
请求线程取得Current Context
→ 提交Task时显式捕获
→ Worker执行时Attach
→ 完成后Detach
```

必须保证 Attach/Detach 成对，否则 Context 会泄漏到线程池的下一个无关任务。不同语言的异步运行时支持不同，应按 SDK 文档验证，而不是认为 ThreadLocal 自动跨线程。

## 6. 消息队列

生产端将 Context 写入消息 Header，消费者提取。需要决定关系模型：

- 同步式短消息处理：Consumer 可延续 Producer Trace；
- 长时间异步：消费者创建新 Trace，并 Link 到 Producer；
- 批量消费：一个 Consumer Span Link 多个消息 Context；
- 重试/DLQ：保留原始因果 Link，并标记 Retry Count。

不能把 Trace Header 放入消息 Key 影响分区，也不能因重试反复覆盖最初的业务关联。

## 7. 定时任务和批处理

Cron/Workflow 没有上游 HTTP Context，应创建 Root Span，并使用稳定 Job 属性：

```text
job.name=daily-settlement
job.run.id=<受控关联ID>
workflow.name=settlement
```

`job.run.id` 可用于 Trace/日志关联，但若进入指标 Label 会形成高基数。批处理拆分时用 Parent/Link 描述分片和汇总关系。

## 8. 抑制重复埋点

自动探针、框架原生 OTel、Service Mesh 和手工代码可能同时创建同一 HTTP Span：

```text
HTTP Client Span（应用自动探针）
└─ HTTP Client Span（框架插件）
   └─ Proxy Span（Mesh）
```

先定义观测边界，再按库禁用重复 Instrumentation。Mesh Span 表示代理视角，应用 Span 表示代码视角，二者可同时保留但必须命名和资源身份清晰。

## 9. Propagator 兼容

优先使用 W3C Trace Context 与 Baggage。迁移旧 B3/Jaeger Header 时可配置 Composite Propagator 同时提取，但注入格式应受控，避免每次请求携带多套冗余 Header。

传播格式改变要灰度验证：Trace 连通率、Header 大小、第三方网关、消息中间件和跨语言 SDK。

## 10. 性能与可靠性

- 使用 Batch Processor 而不是每个 Span 同步发送；
- Exporter 超时和队列满时不能阻塞业务主路径；
- 设置 Span Attribute/Event 限制；
- 对热点操作采样，避免全量昂贵 Span；
- 短进程显式 Shutdown/Flush；
- 监控 Exporter 失败、队列丢弃和 SDK 内部错误。

遥测必须 Fail-open 还是 Fail-closed 取决于合规要求，普通业务通常不应因 Collector 不可用而停止处理请求。

## 11. 断链排查

```text
有下游Span但Trace ID不同
→ 上游是否注入
→ 代理是否保留Header
→ 下游是否提取
→ 异步边界是否捕获Context
→ Propagator格式是否一致
→ Sampling Flag是否被覆盖
```

同时记录两端原始 Trace ID、Header（脱敏）、SDK 版本、Instrumentation 列表和 Collector 接收数。不要只在 Trace UI 凭时间猜父子关系。

## 12. 练习与答案

**问题：启用自动埋点后是否不再需要改代码？**

答案：自动埋点只能识别通用框架边界，业务阶段、错误语义、队列等待和异步因果仍需要手工补充。

**问题：线程池任务偶尔串到错误 Trace，最可能是什么？**

答案：Context Attach 后未正确 Detach，或复用了捕获位置错误的 Context。

## 13. 参考资料

- [OpenTelemetry Instrumentation](https://opentelemetry.io/docs/concepts/instrumentation/)
- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- [OpenTelemetry Libraries](https://opentelemetry.io/docs/languages/)
