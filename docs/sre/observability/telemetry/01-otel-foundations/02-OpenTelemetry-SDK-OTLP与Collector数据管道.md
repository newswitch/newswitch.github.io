---
title: "OpenTelemetry SDK、OTLP 与 Collector 数据管道"
sidebar_label: "02. OpenTelemetry SDK、OTLP 与 Collector"
sidebar_position: 2
description: "从 API、SDK、自动埋点和 OTLP，到 Collector Receiver、Processor、Exporter、Connector 与 Agent/Gateway 部署模式。"
tags: [OpenTelemetry, OTLP, Collector, SDK, Receiver, Exporter]
---

# OpenTelemetry SDK、OTLP 与 Collector 数据管道

OpenTelemetry 是厂商中立的遥测框架和协议体系，不是日志或 Trace 的长期存储数据库。应用通过 API/SDK 或自动埋点产生信号，Collector 接收、处理并导出到一个或多个后端。

## 1. 组件地图

```text
Application
├── OpenTelemetry API
├── OpenTelemetry SDK
│   ├── Resource
│   ├── Tracer/Meter/Logger Provider
│   ├── Processor/Reader
│   ├── Sampler
│   └── Exporter
└── Instrumentation
    ├── Auto Instrumentation
    └── Manual Instrumentation

          OTLP gRPC/HTTP
                 ↓

OpenTelemetry Collector
├── Receivers
├── Processors
├── Exporters
├── Connectors
└── Extensions
                 ↓
Prometheus-compatible Backend / Loki / Tempo / Jaeger / Other
```

## 2. API 与 SDK 的区别

### 2.1 API

应用库可以依赖 OTel API 创建 Span 或 Metric，而不强制决定数据导出到哪里。没有 SDK Provider 时，API 通常退化为 no-op。

### 2.2 SDK

应用部署者配置 SDK：

- Resource；
- Provider；
- Sampler；
- Span/Metric/Log Processor；
- Exporter；
- Batch、Queue 和导出周期。

库作者不应在库内部强制安装全局 Provider 或把数据写死到某个厂商后端。

## 3. Resource 与 Instrumentation Scope

Resource 描述产生遥测数据的实体：

```text
service.name
service.version
deployment.environment.name
host.name
k8s.cluster.name
k8s.namespace.name
k8s.pod.name
cloud.region
```

Instrumentation Scope 描述哪个库/模块和版本产生了数据。

Resource 属性应稳定、有界。Pod UID、容器 ID 可以用于实例关联，但需要考虑重启造成的基数和保留周期。

## 4. 自动埋点与手工埋点

### 4.1 自动埋点

自动捕获常见框架：

- HTTP Server/Client；
- gRPC；
- 数据库客户端；
- 消息客户端；
- 常见 Web 框架。

优点是快速覆盖，边界是不了解业务阶段。例如自动 Trace 看到一个 `/chat` Span，却不知道内部排队、Prefill 和 Decode。

### 4.2 手工埋点

用于业务关键阶段：

```text
validate_request
queue_wait
prefill
decode
persist_outbox
publish_message
```

手工 Attribute 必须控制基数和敏感数据。

## 5. OTLP 是什么

OTLP 是 OpenTelemetry Protocol，用于传输 Traces、Metrics 和 Logs，常见承载：

- OTLP/gRPC；
- OTLP/HTTP Protobuf；
- 目标实现支持的 JSON/HTTP 调试场景。

协议端口、TLS、压缩、超时和认证以 Collector 配置为准。不要仅因为 TCP 端口可达就认为 Export 成功，还要检查 Collector 接收、拒绝和导出指标。

## 6. 为什么生产通常使用 Collector

应用直接导出到后端虽然简单，但会把后端地址、重试、批处理和认证耦合进每个服务。Collector 可以：

- 快速接收并批量发送；
- 统一 TLS 和认证；
- 重试和有界队列；
- 删除敏感属性；
- 增加 Kubernetes/云资源属性；
- 采样和转换；
- 同时导出多个后端；
- 降低应用受后端故障影响。

Collector 不是无限缓存。后端长时间不可用且队列达到上限后，仍可能拒绝或丢弃数据。

## 7. Receiver

Receiver 接收外部数据：

```yaml
receivers:
  otlp:
    protocols:
      grpc: {}
      http: {}
```

其他 Receiver 可抓取 Prometheus、读取主机指标或接收特定协议。可用组件取决于 Collector Distribution，不是所有二进制都包含 contrib 全部组件。

## 8. Processor

Processor 按 Pipeline 顺序处理数据。常见：

- `memory_limiter`：降低 Collector 内存失控风险；
- `batch`：批量导出，提高效率；
- resource/attributes：增删改属性；
- filter：丢弃不需要或敏感数据；
- k8sattributes：关联 Kubernetes 元数据；
- tail_sampling：按完整 Trace 决策；
- transform：按规则转换。

推荐基本顺序需要结合组件语义验证，例如先做内存保护，再进行有状态处理和 batch。错误顺序可能导致敏感字段先被导出或批处理失效。

## 9. Exporter

Exporter 将数据发送到后端：

```yaml
exporters:
  otlp/tempo:
    endpoint: tempo-gateway:4317
  debug:
    verbosity: basic
```

生产必须关注：

- send queue；
- retry on failure；
- timeout；
- TLS 验证；
- 认证扩展；
- 后端限流；
- 导出失败和丢弃计数。

Debug Exporter 可能打印业务数据，只适合隔离测试和脱敏样本。

## 10. Pipeline

Collector 组件只有被引用到 Service Pipeline 才会生效：

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/tempo]
```

定义一个 Processor 但未加入 Pipeline，不会处理任何数据。

不同信号可以使用不同 Pipeline：

```text
traces：otlp → tail_sampling → batch → tempo
metrics：otlp/prometheus → transform → remote_write
logs：otlp/filelog → filter → batch → loki/otlp backend
```

## 11. Connector 与 Extension

Connector 同时作为一个 Pipeline 的 Exporter 和另一个 Pipeline 的 Receiver，用于信号间连接，例如从 Span 生成指标。

Extension 为 Collector 提供不直接处理遥测数据的能力，如：

- health check；
- pprof；
- zPages；
- authentication；
- persistent storage 等。

Extension 同样需要在 `service.extensions` 中启用。

## 12. Agent 与 Gateway 模式

### 12.1 Agent/DaemonSet

靠近应用和节点：

- 快速卸载数据；
- 读取节点/容器日志；
- 增加本地 Kubernetes 元数据；
- 减少应用直接访问集中后端。

### 12.2 Sidecar

隔离性强，但每 Pod 资源成本和配置管理成本高。只在需要独立生命周期、特殊协议或强租户隔离时使用。

### 12.3 Gateway

集中处理：

- Tail Sampling；
- 全局路由；
- 统一认证和出口；
- 跨集群后端；
- 大规模批处理。

常见生产路径：

```text
Application
→ Node Agent Collector
→ Regional/Gateway Collector
→ Backend
```

Gateway 必须做水平扩展、负载均衡和故障域规划。

## 13. Context Propagation 不由 Collector 修复

Collector 收到的是应用已经生成的 Span。如果服务 A 没有把 Trace Context 注入到服务 B，Collector 通常无法猜出正确父子关系。

上下文必须在应用/协议边界传播：

- HTTP headers；
- gRPC metadata；
- messaging headers；
- async executor/context；
- scheduled job link。

## 14. Tail Sampling 的部署要求

Tail Sampling 需要让同一 Trace 的 Span 到达能够共同决策的 Collector 分片。随机把 Span 分发到多个无共享状态的 Gateway，会导致 Trace 不完整和决策错误。

需要：

- 按 Trace ID 一致性路由或专用负载均衡；
- 足够 decision wait；
- 估算每秒 Trace、Span 数和内存；
- Collector 故障时的可接受丢失；
- 错误/慢请求/关键业务采样 Policy 顺序。

## 15. 背压和故障传播

```text
Backend变慢/限流
→ Exporter发送失败
→ Retry与Sending Queue增长
→ Collector内存上升
→ Memory Limiter拒绝
→ Receiver向上游产生背压或丢弃
→ 应用遥测缺口
```

遥测不能拖垮业务。应用 Exporter 必须有界、异步，Collector 需要独立资源、队列上限和自监控。

## 16. Collector 自监控

至少监控：

- accepted/refused spans、metrics、logs；
- sent/failed/filtered 数据；
- exporter queue size/capacity；
- retry、timeout 和 backend response；
- process CPU、RSS、GC；
- pipeline latency；
- config reload/启动失败；
- Collector 副本和负载分布。

字段名称随 Collector 版本和内部遥测稳定性级别变化，应以当前版本文档为准。

## 17. 安全与脱敏

```text
SDK允许清单
→ Agent二次过滤
→ Gateway统一策略
→ 后端租户和访问控制
```

默认不采集：

- Token、Cookie、密码和私钥；
- 完整请求/响应 Body；
- Prompt、模型响应和用户文件内容；
- 数据库参数；
- URL Query 中的敏感值；
- 无界用户/请求标识作为 Metric Label。

OTLP Endpoint 需要 TLS、认证、网络限制和请求大小/速率保护。

## 18. 最小配置验收

```text
[ ] Resource包含稳定service.name和environment
[ ] 应用能生成父子Span并传播Context
[ ] Collector健康和就绪接口可用
[ ] Receiver accepted增加
[ ] Processor按预期过滤/补充属性
[ ] Exporter sent增加且failed为0
[ ] 后端可按Trace ID查询
[ ] 后端不可用时队列、重试和上限符合设计
[ ] 敏感数据扫描无命中
[ ] Collector重启和滚动升级不影响业务
```

## 19. 参考资料

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)
- [Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
