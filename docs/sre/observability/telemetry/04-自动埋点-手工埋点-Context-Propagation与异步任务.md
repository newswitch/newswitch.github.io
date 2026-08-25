---
title: "自动埋点、手工埋点、Context Propagation 与异步任务"
sidebar_label: "04. 埋点与上下文传播"
sidebar_position: 4
description: "比较自动和手工埋点，解决 HTTP、gRPC、消息队列、线程池和异步任务中的 Trace 断链。"
tags: [OpenTelemetry, Auto Instrumentation, Manual Instrumentation, Context Propagation]
---

# 自动埋点、手工埋点、Context Propagation 与异步任务

自动埋点覆盖常见框架和客户端调用，手工埋点补充业务阶段和无法自动识别的异步边界。两者应组合，而不是在同一库重复创建两套 Span。

## 1. 埋点层次

| 方式 | 优点 | 风险 |
| --- | --- | --- |
| Zero-code/Agent | 上线快、覆盖标准库 | 版本兼容、字段不可控 |
| 库内 Instrumentation | 语义接近框架 | 升级和依赖治理 |
| 手工 API | 表达业务阶段 | 侵入代码、易忘记结束 Span |

自动埋点前先建立基线：CPU、内存、延迟、Span/s 和错误率。生产灰度后比较开销，避免一次给所有服务开启所有 Instrumentation。

## 2. 同步调用传播

```text
Server Extract → Context设为Current → 创建Server Span
→ Client Inject到下游 → 下游Extract → 创建Child Span
→ finally结束Span并恢复Context
```

HTTP/gRPC 库通常自动完成 Inject/Extract。自定义协议必须定义 Carrier 和 Propagator，并处理大小、编码和不可信输入。

## 3. 线程池与协程

ThreadLocal Context 不会必然自动进入另一个线程。提交任务时捕获当前 Context，在任务执行时附加并在 finally 释放；否则会断链或把前一个请求的 Context 泄漏给后一个任务。

异步 Span 的生命周期应覆盖真实任务，而不是仅覆盖 `submit()`。Future/Callback 结束时记录状态和异常。

## 4. 消息队列传播

生产者把 Trace Context 注入消息 Header，创建 Producer Span；消费者提取后创建 Consumer Span。消息可能长时间排队、重试或批量消费，父子关系不总适合：

- 单消息连续处理可用 Parent；
- 批量由多个消息触发时使用 Links；
- 重试要记录尝试次数，但不无限拉长一个 Span；
- 不可信外部消息需清洗传播头。

## 5. 手工业务 Span

只为对定位有价值的阶段建 Span，例如 `model.queue_wait`、`model.prefill`、`payment.authorize`。属性使用低基数枚举和规范单位，不记录完整 Prompt、SQL 参数或用户内容。

## 6. 断链排查

比较上游注入 Header、下游接收 Header、当前 Context 和 Export Span。常见原因是代理删除头、异步执行未捕获 Context、采样位变化、重复 SDK Provider 或进程退出前未 Flush。

## 7. 验收

让请求经过 HTTP → 线程池 → 消息队列 → Consumer，证明 Trace ID 连续；再关闭自动埋点中的一个库，观察断点并用手工 Instrumentation 补齐。压测记录开销和 Span 数量。

参考：[OpenTelemetry Instrumentation](https://opentelemetry.io/docs/concepts/instrumentation/)。
