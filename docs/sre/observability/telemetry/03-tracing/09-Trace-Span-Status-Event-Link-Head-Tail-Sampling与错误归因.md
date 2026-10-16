---
title: "Trace、Span、Status、Event、Link、Head/Tail Sampling 与错误归因"
sidebar_label: "09. Trace 语义、采样与错误归因"
sidebar_position: 9
description: "区分调用失败和业务结果，理解完整与不完整 Trace，设计 Head/Tail Sampling 并沿关键路径定位真正根因 Span。"
tags: [OpenTelemetry, Trace, Sampling, Tail Sampling, Error Attribution]
---

# Trace、Span、Status、Event、Link、Head/Tail Sampling 与错误归因

Trace 不是彩色瀑布图，而是一组具有因果关系的 Span。要正确分析它，必须同时理解上下文传播、Span 语义、采样决定和数据完整性。

## 1. Trace 中真正保存了什么

```text
Trace
└─ SERVER span: POST /orders
   ├─ CLIENT span: INSERT orders
   ├─ PRODUCER span: publish payment.requested
   └─ INTERNAL span: render response

另一条异步消费链：
CONSUMER span: payment.requested
  └─ CLIENT span: POST payment-provider
```

Span 通常包含名称、Trace ID、Span ID、Parent Span ID、开始/结束时间、Kind、Status、Attributes、Events、Links 和 Resource。它描述一个操作的边界，而不是每一行函数调用。

Span Kind 表示调用角色：

- `SERVER`：接收同步远程调用；
- `CLIENT`：发起同步远程调用；
- `PRODUCER`：发送或安排异步消息；
- `CONSUMER`：接收和处理消息；
- `INTERNAL`：进程内部操作。

## 2. Status、错误属性和 Event 各自做什么

`Status=ERROR` 表示 Span 所代表的操作失败，不等于程序抛过异常。例如 HTTP 500 通常应标记错误，HTTP 404 是否是错误取决于客户端/服务端语义和当前规范。

异常适合作为 Event 记录：

```text
exception.type
exception.message
exception.stacktrace
```

不要只写 `error=true`，也不要把动态错误消息放入 Span 名称。Span 名称应保持低基数，如 `GET /orders/{id}`；订单号、URL 实值和 SQL 参数放 Attributes，并遵循敏感数据策略。

一个 Span 中可以记录重试 Event：

```text
retry #1: timeout
retry #2: timeout
retry #3: success
```

最终 Status 可以是 OK，但仍应由指标记录重试开销。若每次尝试都是独立远程调用，也可以创建子 Span，避免一个 Event 隐藏 3 秒耗时。

## 3. Parent 与 Link 的区别

Parent 表示一个操作直接由另一个操作触发，形成 Trace 树。Link 表示“与另一个 Span 有因果或批处理关系”，但不把它强行作为父节点。

典型用法：

- 批处理一次消费多条消息：消费 Span Link 到每条消息的生产 Span；
- 作业由多个请求汇聚触发：Link 比任意选择一个 Parent 更准确；
- 重试或重新入队产生新 Trace：Link 到原 Trace 保留关系。

若消息中携带 Trace Context，并希望生产与消费属于同一条 Trace，可建立 Producer→Consumer 父子关系；若队列停留很久、跨信任域或批量消费，则新 Trace 加 Link 通常更容易控制生命周期。

## 4. Head Sampling

Head Sampling 在 Trace 开始时决定是否记录：

```text
入口收到请求
→ 读取父级 sampled 标志
→ ParentBased + TraceIdRatioBased 做决定
→ 下游沿 traceparent 传播相同决定
```

优点是成本低、无需缓存整条 Trace；缺点是决定发生时还不知道最终是否慢、是否失败。1% Head Sampling 可能恰好漏掉唯一一次故障。

ParentBased 能让整条调用链尽量保持一致，但服务不能假设所有上游都可靠。跨信任边界时需限制 Baggage，并考虑外部调用者强制 sampled 带来的成本攻击。

## 5. Tail Sampling

Tail Sampling 在看到一条 Trace 的多个 Span 后再决定：

```text
多个 Collector 接收 Span
→ 按 Trace ID 把同一 Trace 路由到同一个采样器
→ 缓存直到 decision_wait 或确认结束
→ 按错误、延迟、属性、比例等策略保留/丢弃
```

它可以优先保留错误和慢请求，但代价是内存、等待时间和有状态路由。如果同一 Trace 被随机分到不同采样实例，每个实例只看到残片，策略判断会错误。

容量至少考虑：

```text
缓存 Trace 数 ≈ 每秒新 Trace 数 × decision_wait
缓存字节 ≈ 缓存 Trace 数 × 平均 Span 数 × 平均 Span 字节
```

还需给长尾、属性、索引、GC 和峰值留余量。`decision_wait` 太短会漏掉晚到 Span，太长会增加内存和端到端可见延迟。

## 6. 采样会造成统计偏差

如果“错误全留、正常只留 1%”，后端中错误占比一定被放大。不能用保留下来的 Trace 直接计算真实错误率或吞吐。

正确分工：

- RED/USE 等稳定统计使用 Metrics；
- Trace 用于解释单次请求、长尾和依赖路径；
- 由全量 Span 生成 Span Metrics 时，应在 Tail Sampling 之前生成；
- 同一套 Span Metrics 不要同时在 Collector 和 Tempo 生成，否则会重复计数。

## 7. 为什么会出现不完整 Trace

- Context 没有注入或提取；
- 异步任务脱离父 Context；
- 部分 SDK Head Sampling 丢弃；
- Collector 队列满、进程退出或出口失败；
- Tail Sampling 分片不一致或提前决定；
- Span 尚未结束，应用崩溃；
- 后端摄入限流；
- 查询时间范围不覆盖所有 Span；
- 不同服务时钟偏差造成瀑布图错位。

因此“根 Span 下没有数据库 Span”不一定表示未访问数据库。先查看 SDK/Collector 丢弃指标和 Context 传播，再下业务结论。

## 8. 错误归因方法

一条 Trace 中可能同时出现：服务端 500、客户端超时、网关取消、数据库 Context Canceled。定位时按下面顺序：

1. 找用户可见失败的入口 SERVER Span；
2. 沿关键路径找到第一次出现异常延迟或失败语义的 Span；
3. 区分原发错误和取消传播；
4. 检查同一依赖的重试、并发和回退；
5. 用指标确认影响范围，用日志读取错误细节。

示例：数据库 80 ms 成功，支付调用两次各 1.5 s 超时，随后入口返回 504。根因更可能在支付依赖或网络路径，而不是最后被取消的数据库清理 Span。

排队也可能是关键路径：请求总耗时 2 s，但所有子 Span 加起来只有 100 ms，空白时间可能位于线程池、连接池、队列、CPU 调度或尚未埋点的代码。

## 9. 策略示例与验证

一个常见策略是：

```text
保留 ERROR Trace
OR 保留 duration > 2s
OR 保留关键租户/操作
OR 其余按 1% 概率保留
```

这不是固定最佳值。应回放接近真实的流量，验证：采样器内存、决策等待、完整率、不同策略命中比例、出口速率，以及重启期间丢失。

同时保留一个极低比例的无条件随机样本，否则只看错误和长尾会丢失正常基线。

## 10. 练习与答案

**问题：关闭 Sampling 后 Trace 仍缺 Span，说明什么？**

答案：采样不是唯一原因。应检查异步 Context、SDK Flush、Collector 丢弃/路由、后端限流与查询时间范围。

**问题：Tail Sampling 为什么不能简单做无状态 Deployment 加普通 Service？**

答案：普通负载均衡会把同一 Trace 的 Span 分散到多个实例。需要 Trace-aware 路由或稳定分片，使采样实例看到足够完整的数据，同时设计扩缩容时的重新分片和短暂不完整窗口。

参考资料：

- [OpenTelemetry sampling](https://opentelemetry.io/docs/concepts/sampling/)
- [OpenTelemetry trace data model](https://opentelemetry.io/docs/concepts/signals/traces/)
- [Tail Sampling Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor)
