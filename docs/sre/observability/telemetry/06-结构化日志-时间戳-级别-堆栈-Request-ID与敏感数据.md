---
title: "结构化日志、时间戳、级别、堆栈、Request ID 与敏感数据"
sidebar_label: "06. 结构化日志工程"
sidebar_position: 6
description: "从日志记录模型、容器采集链路、时间与关联字段出发，设计可查询、可脱敏且成本受控的生产日志。"
tags: [结构化日志, Request ID, Trace ID, 脱敏, 日志治理]
---

# 结构化日志、时间戳、级别、堆栈、Request ID 与敏感数据

高质量日志不是把自然语言打印得更多，而是把一次事件表示成稳定的数据记录：它在什么时间、由哪个服务实例产生、发生了什么、属于哪次请求、结果和错误是什么。

## 1. 一条日志在系统中的位置

容器环境常见链路如下：

```text
应用日志库
  → stdout/stderr
  → 容器运行时写 CRI 日志文件
  → 节点 Agent（Filelog/Alloy/Fluent Bit）
  → Collector/Gateway
  → Loki 等日志后端
```

应用成功写入 `stdout` 只说明数据进入了本机管道，不等于日志已经持久化。运行时轮转、Agent 读取游标、出口队列、后端限流和对象存储都可能丢数据。

不建议多个容器直接写同一个业务日志文件。标准输出更适合 Kubernetes 的生命周期和节点级采集；必须读文件时，要同时处理轮转、inode 变化、权限和读取检查点。

## 2. 日志记录模型

OpenTelemetry 日志记录可抽象为：

| 字段 | 含义 | 常见误区 |
| --- | --- | --- |
| `Timestamp` | 事件实际发生时间 | 被 Agent 接收时间覆盖 |
| `ObservedTimestamp` | 采集系统首次观察到它的时间 | 把两者差值误判为网络延迟 |
| `SeverityNumber/Text` | 标准化级别和原始级别 | 不同库的 WARN、ERROR 无法比较 |
| `Body` | 日志正文 | 把所有字段再次拼成字符串 |
| `Attributes` | 当前事件的键值字段 | 无限制放大对象或高基数数据 |
| `Resource` | 服务、实例、集群等来源身份 | 每条日志重复手写且命名不一致 |
| `TraceId/SpanId` | 与分布式调用的关联 | 只打印 Request ID，无法跳到 Trace |

推荐事件示例：

```json
{
  "timestamp": "2026-10-10T02:20:30.123456Z",
  "severity_text": "ERROR",
  "event.name": "payment.authorize.failed",
  "service.name": "order-api",
  "service.version": "2026.10.10.1",
  "deployment.environment.name": "prod",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "request_id": "req-01J9...",
  "error.type": "UpstreamTimeout",
  "server.address": "payment.internal",
  "duration_ms": 3021,
  "retry_count": 2
}
```

字段名应来自团队约定或 Semantic Conventions。错误文本、URL 参数、用户 ID 不适合成为 Loki Label，但仍可留作日志属性并在查询时解析。

## 3. 时间戳为什么会骗人

一次日志可能经历三种时间：事件发生时间、进入采集器的时间、写入后端的时间。如果应用异步缓冲 10 秒，查询中看到的“晚到”不是网络耗时。

应做到：

- 统一使用 UTC 或携带明确时区的 RFC 3339 时间；
- 保留毫秒或微秒精度，但不假设机器时钟绝对准确；
- 监控 NTP/chrony 偏差；
- 同时保留事件时间与观察时间，用差值发现采集积压；
- 不依赖不同主机时间戳推导极短阶段耗时，耗时优先使用单调时钟计算。

后端通常允许有限的乱序写入，但这不是无限容忍。时间戳在未来、过旧或超出乱序窗口时，记录可能被拒绝。

## 4. 级别与错误堆栈

- `DEBUG`：临时诊断细节，生产默认关闭或动态采样；
- `INFO`：生命周期和重要业务状态变化；
- `WARN`：操作仍成功，但出现降级、重试或即将触碰边界；
- `ERROR`：当前操作失败，需要定位；
- `FATAL`：进程无法安全继续。

“数据库连接失败”如果已被重试成功，不应每次都按最终业务失败打印 ERROR；否则告警会夸大影响。同一异常也不要在 Repository、Service、Controller 每层重复输出完整堆栈。底层包装错误，上层在掌握业务结果的位置记录一次完整事件。

异常至少保留：`error.type`、受控的 `error.message`、`exception.stacktrace` 和根因链。多行堆栈必须在采集端先合并为一条事件，否则每一行会成为独立日志。

## 5. Request ID、Trace ID 与信任边界

Request ID 是应用或网关用来关联请求的标识；Trace ID 是 Trace Context 的一部分，两者可以并存但不必相同。

```text
外部请求
  → 网关校验或重新生成 request_id
  → 提取/生成 traceparent
  → 日志自动注入 trace_id、span_id
  → 下游传播 W3C Trace Context
```

外部传入的 ID 不是可信数据。需要限制长度、字符集和数量，避免日志注入与内存放大；跨越不可信边界时可重新生成内部 Request ID，并把外部值保存在受控字段。Baggage 也可能把敏感信息传播到多个服务，禁止放 Token、身份号码和原始 Prompt。

## 6. 敏感数据不能只靠正则补救

严禁记录密码、私钥、Authorization、Cookie、完整身份证或银行卡、访问 Token、数据库连接串，以及未经授权的 Prompt/模型输出。

防护顺序应是：

1. 应用只记录允许字段，敏感对象不进入日志调用；
2. 日志库通过字段白名单、掩码和长度限制做第一层保护；
3. Collector 再删除或哈希敏感属性；
4. 后端执行租户隔离、最小权限、审计和保留期；
5. 用自动化测试提交恶意 Header、堆栈和嵌套对象，验证不会泄漏。

Collector 中的脱敏发生在出口之前才有意义；若上游已经把明文写入节点文件，它仍可能存在于磁盘、崩溃转储或采集器调试日志中。

## 7. 体积、背压与丢失语义

日志库的异步队列能降低请求时延，但队列满时必须明确选择：阻塞业务、丢 DEBUG/INFO、同步输出 ERROR，还是落入本地应急文件。任何策略都有代价，不能只写“异步提高性能”。

治理手段包括：

- 对健康检查和成功请求采样或转成指标；
- 限制正文、数组、堆栈与单字段长度；
- 大对象只记录大小、摘要和受控引用；
- 用聚合事件替代循环内逐条输出；
- 区分应用日志、审计日志和安全日志的保留与权限；
- 监控每秒字节数、丢弃数、队列长度、重试和出口延迟。

粗略估算每天原始量：

```text
每日原始日志量 ≈ 平均每条字节数 × 每秒条数 × 86400
```

再乘副本、对象存储保留和索引开销，最后除以压缩比。不能只根据压缩后的样本反推峰值写入能力。

## 8. 上线验收与排障顺序

分别制造正常请求、重试成功、最终超时、异常堆栈、超长正文、恶意换行和敏感 Header，然后逐层确认：

```text
应用输出存在
→ CRI 文件完整且轮转后仍继续采集
→ Agent 已读取并推进检查点
→ Collector 未因队列、内存或出口失败丢弃
→ 后端接收时间和事件时间合理
→ JSON 可解析、Trace 可跳转、敏感字段不可见
```

“Grafana 搜不到”时不要先改查询。先用唯一测试 ID 确认它在哪一层消失，再判断是时间范围、Label、解析、限流还是实际未送达。

## 9. 练习与答案

**问题：为什么不应把 `trace_id` 设为 Loki Label？**

答案：几乎每次 Trace 都不同，会创建海量短命 Stream，增加索引、内存和小 Chunk。它应留在正文或结构化元数据中，查询时解析或通过日志—Trace 派生字段跳转。

**问题：应用时间与采集时间相差持续变大说明什么？**

答案：通常说明应用缓冲、文件读取、Collector 队列或后端写入正在积压。结合各层队列长度、重试和丢弃指标定位，不能直接归因于网络。

参考资料：

- [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
