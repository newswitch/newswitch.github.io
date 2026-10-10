---
title: "OpenTelemetry Collector：Receiver、Processor、Exporter、Connector 与 Extension"
sidebar_label: "05. Collector 组件与流水线"
sidebar_position: 5
description: "拆解 Collector Factory、Pipeline、Consumer、Queue 和组件生命周期，掌握 Receiver、Processor、Exporter、Connector、Extension 的顺序、背压和排障。"
tags: [OpenTelemetry Collector, Receiver, Processor, Exporter, Connector]
---

# OpenTelemetry Collector：Receiver、Processor、Exporter、Connector 与 Extension

Collector 不是“转发端口”。它在接收、处理、排队和导出之间建立多信号流水线，并承担内存保护、重试、批处理、路由和协议转换。

```text
Receiver → Processor链 → Exporter
                  └→ Connector → 另一个Pipeline
Extension：健康、认证、存储、调试等旁路能力
```

## 1. 配置对象与启用关系

定义组件不等于运行组件，只有被 `service.pipelines` 或 Extension 列表引用才会启动：

```yaml
receivers:
  otlp:
    protocols:
      grpc: {endpoint: 0.0.0.0:4317}
      http: {endpoint: 0.0.0.0:4318}

processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 75
    spike_limit_percentage: 15
  batch:
    timeout: 5s
    send_batch_size: 8192

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: false

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/tempo]
```

同一类型可通过 `type/name` 建多个实例，例如 `otlp/internal` 和 `otlp/external`。

## 2. Receiver

Receiver 负责监听协议或主动抓取数据，例如 OTLP、Jaeger、Zipkin、Prometheus Receiver、Filelog。它把外部格式转换为 Collector 内部的 Logs/Metrics/Traces 数据模型。

Receiver 成功响应客户端不一定代表数据已安全进入最终后端，取决于后续队列、持久化和确认语义。必须理解所用协议何时 ACK。

## 3. Processor 的顺序就是语义

常见 Processor：

- `memory_limiter`：在进程接近限制时拒绝/施加背压；
- `batch`：聚合请求，减少网络开销；
- `attributes/resource`：增加、删除、哈希属性；
- `filter`：按条件丢弃；
- `transform`：使用 OTTL 转换信号；
- `tail_sampling`：等待 Trace 更完整后决定保留；
- `k8sattributes`：按连接/IP/资源关联 Kubernetes 元数据。

推荐把 `memory_limiter` 放在前面，让大多数处理前先保护内存；批处理通常放在靠近 Exporter 的位置。过滤在采样前后会改变采样输入，脱敏在导出前必须完成。

## 4. Exporter、队列与重试

Exporter 将数据发送到 OTLP 后端、Prometheus Remote Write、Loki 等目的地。生产应配置发送队列和重试，并监控：

```text
accepted records
refused records
queue size/capacity
send failed
retry delay
dropped records
export latency
```

内存队列只能吸收短故障，进程重启会丢失未发送数据；需要跨重启缓冲时使用受支持的持久队列/Storage Extension，并验证磁盘容量和恢复吞吐。

队列只是延迟故障。若输入长期高于输出，最终仍会满。

## 5. Connector

Connector 同时充当一个 Pipeline 的 Exporter 和另一个 Pipeline 的 Receiver：

```text
Traces Pipeline
→ spanmetrics Connector
→ Metrics Pipeline
→ Prometheus Remote Write
```

还可生成 Service Graph 或转发路由。Connector 产生的指标基数取决于 Span Attribute 维度，添加 `url.full`、用户 ID 等字段会造成指标爆炸。

## 6. Extension

Extension 不直接处理主数据流，常用于：

- Health Check；
- Bearer/OAuth 等认证；
- Persistent Storage；
- pprof/zPages 调试；
- File Storage；
- 远程管理或观察能力。

Extension 的端口和调试接口可能暴露内部数据，应受网络和认证保护。生产不要将 pprof/zPages 直接暴露公网。

## 7. Backpressure 怎样传播

```text
后端变慢
→ Exporter请求延迟/失败
→ Sending Queue增长
→ Queue满
→ Processor/Receiver拒绝
→ SDK Exporter重试或丢弃
→ 应用侧出现otel exporter错误
```

有些协议能把拒绝反馈给上游，有些文件采集可能继续读并在本地记录 Offset。必须对每条 Pipeline 明确最远可恢复点，而不是只看 Collector 没崩。

## 8. Memory Limiter 与容器限制

Collector 看到的是进程内存，但 Kubernetes OOMKill 由 cgroup Limit 决定。Memory Limiter 阈值应低于容器 Limit，给 Go Runtime、队列外内存和突发留余量。

触发 Limiter 表明系统已过载，应让可重试上游退避。若上游不会重试，则拒绝就是数据损失；不能把 Limiter 当正常限流器。

## 9. Tail Sampling 的状态代价

Tail Sampling 必须在决策等待期内按 Trace ID 聚合 Span：

```text
所有同一Trace的Span
→ 路由到同一Sampler实例
→ 等待决策窗口
→ 按错误/延迟/属性策略决定
```

若负载均衡不按 Trace ID，Span 分散到不同 Collector，策略会基于不完整 Trace。决策等待时间、并发 Trace 数和每 Trace Span 数共同决定内存。

## 10. 配置校验和调试

不同发行版包含的组件集合不同，Core、Contrib、Vendor Distribution 不能混为一谈。启动前使用当前二进制提供的配置校验命令，并核对组件清单。

排障顺序：

1. Receiver 是否监听并收到数据；
2. Accepted/Refused 是否异常；
3. Processor 是否过滤/采样；
4. Queue 是否增长；
5. Exporter 是网络、认证、限流还是格式错误；
6. 后端是否可查询对应 Tenant/时间范围。

临时 Debug Exporter 会输出遥测内容，可能包含敏感数据，只在隔离环境、有限采样下启用。

## 11. Collector 自监控

通过内部 Metrics/Logs 观察接收、处理、队列、导出、CPU、内存和 GC。指标名称会随 Collector Telemetry Schema 演进，应以当前发行版为准并对升级做 Dashboard 回归。

健康探针只说明进程存活，不代表每条 Pipeline 都能导出。Readiness 应结合关键 Exporter/Queue 状态或外部端到端探针。

## 12. 练习与答案

**问题：配置中定义了 OTLP Exporter，但后端收不到数据，为什么？**

答案：Exporter 可能没有被任何 Pipeline 引用；也可能 Pipeline Signal 类型不匹配。

**问题：增大 Sending Queue 是否能解决长期后端吞吐不足？**

答案：不能，只会延后队列填满；必须提高输出能力、降低输入或扩容并验证后端配额。

## 13. 参考资料

- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
- [Collector Components](https://opentelemetry.io/docs/collector/components/)
- [Collector Scaling](https://opentelemetry.io/docs/collector/scaling/)
- [Collector Resiliency](https://opentelemetry.io/docs/collector/resiliency/)
