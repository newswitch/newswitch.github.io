---
title: "Tempo、Jaeger 部署、TraceQL、Span Metrics 与 Service Graph"
sidebar_label: "13. Trace 后端生产实践"
sidebar_position: 13
description: "部署 Tempo 与 Jaeger v2，配置 OTLP、存储与查询，并解释 TraceQL、Span Metrics 和 Service Graph 的数据来源与边界。"
tags: [Tempo, Jaeger, TraceQL, Span Metrics, Service Graph]
---

# Tempo、Jaeger 部署、TraceQL、Span Metrics 与 Service Graph

生产 Trace 平台至少包含四件事：可靠接收、可恢复存储、可控查询和可解释的派生指标。只把 OTLP 端口暴露出来，还不能称为生产部署。

## 1. 先定义数据流

```text
Application SDK
→ Node/Gateway OTel Collector
→ Tail Sampling（可选）
→ Tempo 或 Jaeger
→ Grafana / Jaeger UI

Trace 全量分支（采样前）
→ Span Metrics / Service Graph
→ Prometheus/Mimir
```

要标明每一步由谁负责批处理、重试、采样、租户、脱敏和指标生成。职责重复会造成双倍数据，职责空缺会造成不可见盲区。

## 2. Tempo 部署模式

单体模式适合学习和较小环境；当前微服务模式适合需要独立扩展的生产环境，并依赖 Kafka 兼容持久队列、对象存储、Live Store、Block Builder 和后台工作组件。

生产准备至少包括：

- 版本匹配的 Helm Chart 与 Values；
- 对象存储 Bucket、凭据、TLS、生命周期和访问延迟；
- 队列分区、副本、保留、容量与消费滞后；
- Distributor、Live Store、Block Builder、Querier 和后台任务资源；
- Gateway 认证、Tenant Header 注入和 NetworkPolicy；
- 查询限制、保留、PDB、拓扑分布、监控与告警。

不要根据旧版本架构图猜当前 Chart 的 Target 名称。升级前以目标版本的架构与迁移文档为准。

## 3. Jaeger v2 部署

Jaeger v2 基于 OTel Collector 组件模型，建议按 v2 配置 receiver、processor、storage exporter/extension 与 query 服务。旧版 `jaeger-agent` 参数和 v1 YAML 不应直接复制。

可选择 Collector 直接写后端，或经 Kafka 解耦后由 Ingester 消费。生产检查包括：

- OTLP 接收协议与 TLS；
- 存储后端兼容性、索引/Shard、保留和备份；
- Kafka 分区、积压、重复与恢复；
- Query/UI 的认证和访问控制；
- v2 配置校验与滚动升级；
- 独立 OTel Collector 与 Jaeger 内部处理器是否重复。

## 4. OTLP 接入与端到端测试

常见端口是 OTLP/gRPC `4317` 与 OTLP/HTTP `4318`，但 Service、TLS 和路径均可能被修改。客户端必须明确 endpoint 是否包含协议和路径。

用测试应用生成一个已知 Trace，并记录：

```text
trace_id
service.name
deployment.environment.name
一个可搜索属性
一个异常 Event
一次跨服务调用
```

随后验证 Collector 接收/发送计数、后端摄入、Trace ID Lookup、属性搜索和日志跳转。只看后端 Pod Ready 不算验收。

## 5. TraceQL 的思考方式

TraceQL 用 Span 属性和 Trace 结构查询，而不是全文日志搜索。示意查询：

```traceql
{ resource.service.name = "order-api" && status = error }
```

查找慢 Span：

```traceql
{ resource.service.name = "payment-api" && duration > 2s }
```

实际字段命名和语法应以部署版本文档为准。先限定时间范围和稳定 Resource，再增加 Span 属性与结构条件；动态用户 ID 和完整 URL 会增加搜索成本并带来隐私风险。

TraceQL Metrics 可从 Trace 数据计算指标，但不等同于预先生成的 Prometheus 时间序列。大时间范围、高基数聚合的成本和适用场景不同。

## 6. Span Metrics 是怎样产生的

Span Metrics 通常按服务、操作、Span Kind、状态码等维度生成调用次数、错误和延迟直方图：

```text
Span
→ 按维度归类
→ calls_total
→ duration histogram
→ Prometheus Remote Write
```

它可用于 RED 视图，但不是应用原生业务指标的完整替代品：

- 未埋点路径不会出现；
- 采样后的 Span 会低估流量并产生偏差；
- 重试会被计为多次调用；
- 自定义维度可能制造时序基数；
- SDK/Collector 丢失也会反映到指标。

若使用 Tail Sampling，应在采样前生成 Span Metrics，或接受它只代表保留样本。Tempo Metrics Generator 与 Collector spanmetrics connector 二选一作为权威来源，避免重复。

## 7. Service Graph 是如何推导的

Service Graph 通过匹配 CLIENT/SERVER 或 PRODUCER/CONSUMER Span，推导服务之间的边和请求指标：

```text
order-api --HTTP--> payment-api
producer  --queue-> consumer
```

无法匹配时常见原因：

- Context 传播中断，Trace ID 不同；
- Span Kind 错误；
- `service.name` 缺失或所有服务都叫默认值；
- 一侧被采样或丢弃；
- 处理窗口太短，另一侧 Span 晚到；
- 异步链路应使用 Link，但生成器不支持对应关系。

图上没有边不能直接证明两个服务没有调用；需要结合 Trace、指标和 Collector 丢弃情况。

## 8. Exemplars 把指标带回 Trace

直方图样本可附带 Trace ID 作为 Exemplar：

```text
P99 延迟告警
→ Grafana 打开慢桶上的 Exemplar
→ 跳转到 Tempo/Jaeger Trace
→ 再通过 trace_id 查询日志
```

这要求 Metrics 和 Trace 使用兼容的 Resource、数据源与跳转配置。Exemplar 是样例，不是该桶中所有请求，采样策略也可能导致跳转目标不存在。

## 9. 容量与保留

粗略写入量：

```text
Span/s = 请求/s × 平均每请求 Span 数
原始字节/s = Span/s × 平均序列化字节
每日容量 = 字节/s × 86400 × 保留/压缩/副本修正
```

还要计算队列积压：若后端停止 30 分钟，恢复消费速率必须高于当前生产速率，否则永远追不上。对象存储容量足够不代表 Distributor、队列和 Block Builder 能承受回放峰值。

## 10. 多租户与安全

- 由可信 Gateway 完成认证并注入 Tenant；
- OTLP 外部入口启用 TLS/mTLS、限流和消息大小限制；
- 删除 Token、Cookie、SQL 参数、Prompt 等敏感属性；
- Query/UI 单独做身份和租户授权；
- 对象存储、Kafka 和指标后端使用最小权限；
- 为租户限制摄入、搜索并发、保留和高基数维度。

## 11. 升级与故障演练

升级时分别验证：OTLP 兼容、存储格式、查询旧 Block、队列协议、Chart Values 和 TraceQL 行为。不要一次同时升级 Collector、后端、schema 和 SDK。

至少演练：

1. Collector Gateway 重启与队列 Flush；
2. 对象存储短时不可用；
3. Kafka 分区或 Broker 故障；
4. 查询组件过载但写入保持；
5. 尾采样器扩缩容；
6. 凭据和证书轮换；
7. 保留到期和单 Trace 删除边界。

## 12. 练习与答案

**问题：为什么 Service Graph 有流量，但应用 QPS 指标不同？**

答案：Span Metrics 统计的是 Span，可能存在采样、丢失、重试、重复和 Span Kind/维度差异；应用 QPS 的统计入口也可能不同。先统一口径，不要要求两个系统数字天然相等。

**问题：Tail Sampling 后再生成 Span Metrics 会怎样？**

答案：指标只代表保留下来的 Trace，而且按错误/慢请求优先采样会严重放大失败率和长尾。若目标是真实 RED 指标，应在采样前生成。

参考资料：

- [Tempo setup](https://grafana.com/docs/tempo/latest/setup/)
- [Tempo metrics-generator](https://grafana.com/docs/tempo/latest/metrics-generator/)
- [Tempo TraceQL](https://grafana.com/docs/tempo/latest/traceql/)
- [Jaeger deployment](https://www.jaegertracing.io/docs/latest/deployment/)
