---
title: "日志、指标、Trace 与一次请求的统一证据链"
sidebar_label: "01. 三类信号与统一请求证据链"
sidebar_position: 1
description: "从用户请求出发，解释 Metrics、Logs、Traces 分别回答什么，以及如何用 Trace ID、Resource 和时间线把网关、服务、队列与模型关联起来。"
tags: [Logs, Metrics, Traces, Trace ID, Observability]
---

# 日志、指标、Trace 与一次请求的统一证据链

指标告诉你“故障是否普遍”，Trace 告诉你“请求在哪一段花时间”，日志告诉你“组件当时记录了什么细节”。任何单一信号都无法稳定回答复杂分布式故障。

## 1. 三类信号分别回答什么

| 信号 | 主要问题 | 典型内容 | 主要边界 |
| --- | --- | --- | --- |
| Metrics | 多少、多久、趋势怎样 | QPS、错误率、P95、队列、资源 | 不保存完整单请求细节 |
| Logs | 发生了什么、错误细节是什么 | 事件、堆栈、状态变更、请求摘要 | 搜索成本和结构质量差异大 |
| Traces | 一次请求经过哪里、每段多久 | Trace、Span、父子关系、Attribute | 采样后不是所有请求都存在 |

Profiles 进一步回答“CPU/内存时间花在哪段代码”，但本文先建立三类基础信号。

## 2. 一个请求的完整路径

```text
Client
→ CDN/Load Balancer
→ Nginx/Higress/Envoy
→ API Service
→ Redis
→ MySQL/PostgreSQL
→ Kafka/RabbitMQ
→ Worker
→ vLLM/SGLang/MindIE
→ GPU/NPU
→ Stream Response
```

统一证据至少包含：

```text
event time + timezone
trace_id
span_id / parent_span_id
request_id（业务/网关标识）
service.name
service.version
deployment.environment
cluster / namespace / pod / node
model / framework / rank（AI场景）
```

不是所有字段都应成为 Prometheus Label。高基数 ID 应存在 Trace 和结构化日志中。

## 3. 指标怎样发现问题

假设告警显示：

```text
service=chat-api
P95 TTFT从1.2s升到8s
错误率仍低
队列持续增长
```

指标可以回答：

- 影响开始时间；
- 全部实例还是单个实例；
- 特定模型/区域/版本；
- TTFT、ITL 哪个变化；
- 请求量是否增长；
- 队列、KV Cache、GPU/NPU 是否同步变化。

指标很难直接告诉你某个请求在哪个函数或下游调用慢，需要 Trace。

## 4. Trace 怎样缩小阶段

一个 Trace 由多个 Span 组成：

```text
Trace abc123
└── gateway POST /chat                 8.6s
    └── api validate                   5ms
    └── redis GET                      2ms
    └── inference request              8.5s
        ├── queue wait                 6.7s
        ├── prefill                    1.1s
        └── decode                     0.7s
```

由此可知主要时间在排队，不应直接优化 GPU Kernel。

Trace 还可携带：

- HTTP method/status/route；
- RPC system/service/method；
- DB system/operation；
- messaging system/destination/operation；
- exception event；
- model、token 和 batch 等经过治理的 AI 属性。

不要记录完整 Prompt、Authorization、Cookie 或 SQL 参数等敏感内容。

## 5. 日志怎样提供细节

找到异常 Span 后，用 Trace ID 查询同时间日志：

```json
{
  "timestamp": "2026-08-25T14:20:31.842+08:00",
  "level": "ERROR",
  "service": "inference-api",
  "trace_id": "abc123",
  "span_id": "def456",
  "request_id": "req-789",
  "event": "engine_request_failed",
  "error_type": "WorkerExited",
  "worker_rank": 1,
  "message": "engine worker exited before stream completed"
}
```

日志可以提供：

- 首个异常和完整堆栈；
- 重试、取消和状态机变化；
- Worker、Rank 和设备映射；
- 配置和版本摘要；
- 不适合做指标 Label 的业务上下文。

## 6. 统一时间是前提

如果网关、应用、节点和设备日志相差几十秒，无法判断因果顺序。必须：

- 使用可靠 NTP/PTP；
- 日志保留时区或统一 UTC；
- 采集器保留原始事件时间；
- 区分事件发生时间和 Collector 接收时间；
- 监控时钟偏差；
- 事故报告明确时区。

日志到达顺序不一定等于发生顺序，特别是缓冲、批处理和网络恢复后补发。

## 7. Context Propagation

Trace ID 需要通过协议传播：

```text
HTTP headers
gRPC metadata
message headers/properties
异步任务上下文
```

OpenTelemetry 常使用 W3C Trace Context。服务收到上游 Context 后创建 Child Span，并在调用下游时注入当前 Context。

如果某一跳没有传播：

```text
Trace A结束于Service B
Service C重新创建Trace X
→ 链路被截断
```

异步消息不能简单用长时间 Parent/Child 表达所有关系，可能需要 Span Link 表示生产与一个或多个消费之间的因果关系。

## 8. Request ID 与 Trace ID 的区别

| ID | 作用 |
| --- | --- |
| Trace ID | 分布式 Trace 的全链路身份，由遥测系统传播 |
| Span ID | 单个操作身份 |
| Request ID | 网关或业务请求身份，可能用于幂等、客服和审计 |
| Message ID | 消息身份，用于幂等和重复检测 |

它们可以互相关联，但不要强制认为必须相同。一个业务请求可能产生多个消息和后续 Trace；一次消息重试也可能创建新 Span。

## 9. Metrics 怎样跳转到 Trace

Histogram 可通过 Exemplar 关联一个代表性 Trace ID：

```text
P99延迟曲线出现尖峰
→ 点击该Bucket的Exemplar
→ 打开Tempo/Jaeger中的Trace
→ 找到慢Span
→ 使用Trace ID查询Loki日志
```

Exemplar 不应为每个请求创建 Prometheus Label，而是附着在样本上的稀疏关联信息。

## 10. 日志怎样生成指标

Loki/LogQL 可从结构化日志计算：

- 错误日志速率；
- 特定事件计数；
- 解析字段的分布；
- 无法预先埋点的临时故障信号。

但稳定的 SLO 指标应尽量从应用或明确的 Recording Rule 产生，而不是长期依赖昂贵日志扫描。

## 11. Trace 怎样生成指标

Trace 后端或 Metrics Generator 可从 Span 生成：

- 请求率；
- 错误率；
- 延迟 Histogram；
- Service Graph；
- Span Metrics。

采样会影响数值解释。如果只保留错误和慢请求，不能直接把采样后的 Span 数当成真实总请求数。

## 12. 采样发生在哪里

### 12.1 Head Sampling

在 Trace 开始时决定是否采样，开销小，但当时还不知道请求最终是否错误或变慢。

### 12.2 Tail Sampling

Collector 收齐或等待足够 Span 后，根据状态、延迟和属性决定：

- 保留所有错误；
- 保留超过阈值的慢请求；
- 保留关键租户/模型；
- 对普通成功请求按比例采样。

代价是需要在 Collector 中暂存 Trace，增加内存、延迟和伸缩复杂度。

## 13. 一次 AI 推理故障怎样联合分析

现象：GPU 利用率 30%，TTFT 超标。

```text
Metrics
→ TTFT高、ITL正常、queue waiting高

Trace
→ gateway正常、tokenizer正常、queue_wait占主要时间

Logs
→ 一个Worker反复退出，健康副本减少

Device Metrics/Logs
→ 目标Rank对应NPU发生UCE或GPU Xid
```

结论是容量因 Worker 故障下降并形成排队，不是“GPU 利用率低所以增加并发”。

## 14. 数据安全

遥测管道常接触高敏感信息。默认禁止：

- Authorization、Cookie、Token、密码、私钥；
- 完整 Prompt 和模型响应；
- 用户手机号、身份证、邮箱等 PII；
- 数据库绑定参数；
- 内部 Secret 和环境变量全集；
- 对象存储签名 URL。

应在 SDK 和 Collector 两层做属性允许清单、脱敏和大小限制，并控制后端租户和查询权限。

## 15. 故障证据清单

```text
[ ] 告警开始时间、恢复时间和时区
[ ] 受影响service/version/cluster/pod
[ ] 代表性Trace ID和完整Span树
[ ] Trace ID对应的结构化日志
[ ] 指标查询和时间范围
[ ] 采样策略与是否可能漏Trace
[ ] Collector队列、拒绝、重试和导出失败
[ ] Loki/Tempo后端写入与查询状态
[ ] 变更、发布和配置时间线
```

## 16. 参考资料

- [OpenTelemetry Signals](https://opentelemetry.io/docs/concepts/signals/)
- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/)
- [Grafana Tempo Tracing Setup](https://grafana.com/docs/tempo/latest/set-up-for-tracing/)
