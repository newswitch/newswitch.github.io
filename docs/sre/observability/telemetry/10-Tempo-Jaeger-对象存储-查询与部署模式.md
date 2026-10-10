---
title: "Tempo、Jaeger、对象存储、查询与部署模式"
sidebar_label: "10. Trace 后端架构与选型"
sidebar_position: 10
description: "比较 Tempo 与当前 Jaeger v2 的接入、写读路径、存储、查询和部署模式，并说明选型边界。"
tags: [Tempo, Jaeger, TraceQL, 对象存储, 分布式追踪]
---

# Tempo、Jaeger、对象存储、查询与部署模式

OpenTelemetry 负责生成、规范和输送 Trace；Tempo 与 Jaeger 负责接收、存储和查询。二者都支持 OTLP，但内部路径、查询能力、存储选择和运维模型不同。

## 1. 先避免版本错位

很多旧资料描述 `Jaeger Agent → Collector → Elasticsearch/Cassandra`。这是 Jaeger v1 的经典架构。当前 Jaeger v2 基于 OpenTelemetry Collector 的组件模型构建，配置和扩展方式已明显变化；学习时应标明版本，不能把 v1 参数直接套到 v2。

Tempo 也在演进。除单体部署外，当前微服务模式引入 Kafka 兼容的持久队列、Live Store 与 Block Builder。旧架构图或旧 Helm 值可能仍以 Ingester 为中心，实际部署必须以目标版本文档为准。

## 2. Tempo 单体模式

单体模式把 Distributor、Ingester、Querier、Query Frontend、Compactor 等逻辑组件放在一个进程中：

```text
OTLP
→ Tempo monolithic
   ├─ 接收与校验
   ├─ 内存/WAL 缓冲和构建 Block
   ├─ 对象存储
   └─ TraceQL/Trace ID 查询
```

它适合本地学习、测试和规模较小的环境。可运行多个相同实例形成高可用单体，但写入、查询和后台任务不能独立扩缩容。

## 3. Tempo 当前微服务路径

当前生产微服务模式可概括为：

```text
写入：
OTLP → Distributor → Kafka 兼容队列
                     ├─ Live Store：近期查询
                     └─ Block Builder：生成 Parquet Block → 对象存储

读取：
Grafana/Client → Query Frontend → Querier
                 ├─ Live Store 查询近期数据
                 └─ 对象存储查询历史 Block

后台：Backend Scheduler/Worker → Compaction、Retention 等任务
可选：Metrics Generator → Span Metrics / Service Graph / Exemplars
```

持久队列把接收与 Block 构建解耦，能吸收短时波动，但同时引入队列容量、分区、副本、消费滞后和升级兼容性。对象存储仍是长期数据核心。

## 4. Tempo 的查询模型

- **Trace ID Lookup**：已知 Trace ID 时直接定位完整 Trace；
- **TraceQL Search**：按 Span/Resource 属性、结构和持续时间搜索；
- **TraceQL Metrics**：从 Trace 数据计算一定范围的指标；
- **Metrics Generator**：摄入时生成 Span Metrics、Service Graph 等时序数据。

搜索能力不等于“任意属性都免费索引”。属性基数、Block 布局、查询时间范围和对象存储吞吐仍决定成本。Grafana 中的服务图通常依赖生成的指标，不是仅靠 UI 自动推导。

## 5. Jaeger v2 架构

Jaeger v2 使用 OTel Collector 的 receiver、processor、exporter 与 extension 组件组合 Trace 后端。常见两种可扩展路径：

```text
直接写存储：
SDK/OTel Collector → Jaeger Collector → Storage

队列解耦：
SDK/OTel Collector → Jaeger Collector → Kafka
                                      → Ingester → Storage

查询：Jaeger Query/UI → Storage
```

直接写存储组件少、延迟低；Kafka 路径可吸收写入峰值和隔离存储故障，但需要运维 Broker、分区、消费延迟和重复处理。存储支持能力取决于 Jaeger 版本及所选后端，必须核对官方兼容列表。

Jaeger v2 可以直接承担 OTLP 接收，也可以在前面部署独立 OTel Collector 做统一处理、鉴权和路由。不要无意中在两层重复 Batch、重试或 Span Metrics。

## 6. 对象存储与传统搜索存储的取舍

Tempo 强调以对象存储保存 Trace，通常具有较低长期容量成本和较简单的存储扩容路径，但查询可能受对象请求、扫描与缓存影响。

Jaeger 的后端选择更灵活。使用 Elasticsearch/OpenSearch 等存储可获得其索引和运维生态，但索引成本、Shard 规划和集群维护更重。不能只比较“能不能查询”，还要比较：

- 峰值 Span/s 与平均 Span 大小；
- 保留期和每天新增字节；
- 按 Trace ID 与按属性搜索的比例；
- 多租户隔离和权限；
- 故障恢复与跨区域要求；
- 团队已有存储能力。

## 7. 共同的接入边界

推荐业务 SDK 发送 OTLP 到就近 Collector，再由网关写后端：

```text
SDK → Agent/Gateway Collector → Tempo 或 Jaeger
```

这样能统一 Resource 属性、批处理、限流、脱敏和迁移。SDK 直接写后端虽然组件少，但后端地址、认证与重试策略会散落在每个应用中。

无论选谁，都需明确：

- OTLP gRPC/HTTP 端口和 TLS；
- 最大消息大小、压缩和超时；
- Tenant/Header 只能由可信网关注入；
- Head/Tail Sampling 的责任层；
- 后端不可用时客户端、Collector 和队列怎样背压或丢弃。

## 8. 选型对照

| 维度 | Tempo | Jaeger v2 |
| --- | --- | --- |
| 主要长期存储思路 | 对象存储 Block | 按支持列表选择后端，也可经 Kafka 解耦 |
| 查询体验 | Trace ID、TraceQL、TraceQL Metrics | Jaeger Query/UI 和后端支持的搜索 |
| 组件生态 | 与 Grafana、Loki、Mimir/Prometheus 关联紧密 | Jaeger UI/生态，v2 复用 OTel Collector 模型 |
| 小规模部署 | 单体 | all-in-one/组合式部署，按 v2 文档 |
| 大规模写入 | 当前微服务模式使用持久队列与 Block 构建 | Collector 直写或 Kafka→Ingester |
| 主要成本关注 | 对象请求、扫描、缓存、队列 | 存储索引/Shard、Kafka 与查询集群 |

表格不是胜负结论。如果团队已有 Grafana 可观测性栈和对象存储，Tempo 往往更自然；若已有 Jaeger 生态、既定存储和查询习惯，Jaeger v2 可能迁移成本更低。

## 9. 故障现象与路径

- **Trace ID 查不到**：先确认 SDK Export、Collector 丢弃、采样决定和后端摄入，再查存储；
- **近期查不到、稍后出现**：检查队列消费、Live Store/Ingester 与 Block 构建延迟；
- **已知 ID 快、属性搜索慢**：检查时间范围、属性基数、对象/索引扫描和查询队列；
- **摄入成功但 Trace 残缺**：检查 Context、Trace-aware 路由、尾采样和 late Span；
- **存储恢复后积压暴涨**：限制回放速率，避免消费积压把后端再次压垮。

## 10. 生产验证

1. 生成带固定 Trace ID 的正常、错误、慢调用和异步调用；
2. 验证已知 ID、属性搜索、关联日志和服务图；
3. 中断对象存储或查询存储，观察写入队列、恢复和重复；
4. 重启接收、构建和查询组件，确认故障域；
5. 用真实 Span 大小估算保留成本，并测试保留删除；
6. 进行滚动升级和旧数据查询回归。

## 11. 练习与答案

**问题：使用 Kafka 后是否就不会丢 Trace？**

答案：不会自动保证。还要看生产确认、Topic 副本、保留期、磁盘、消费者 Offset、下游幂等与积压期间的容量。Kafka 只是提供持久缓冲，不替代端到端验收。

**问题：Tempo 与 Jaeger 前面是否还需要 Collector？**

答案：不是协议上的硬要求，但生产中常有价值：统一认证、属性治理、批处理、采样和后端迁移。需要避免两层重复处理并监控每一跳。

参考资料：

- [Tempo architecture](https://grafana.com/docs/tempo/latest/get-started/architecture/)
- [Tempo TraceQL](https://grafana.com/docs/tempo/latest/traceql/)
- [Jaeger architecture](https://www.jaegertracing.io/docs/latest/architecture/)
- [Jaeger deployment](https://www.jaegertracing.io/docs/latest/deployment/)
