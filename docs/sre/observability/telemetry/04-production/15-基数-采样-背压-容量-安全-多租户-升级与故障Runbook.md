---
title: "基数、采样、背压、容量、安全、多租户、升级与故障 Runbook"
sidebar_label: "15. 遥测生产治理与 Runbook"
sidebar_position: 15
description: "用统一容量模型治理指标、日志和 Trace 的基数、队列、采样、租户、安全、升级与故障恢复。"
tags: [Observability, Capacity Planning, Backpressure, Multi-tenancy, Runbook]
---

# 基数、采样、背压、容量、安全、多租户、升级与故障 Runbook

可观测性平台的悖论是：业务越故障，错误日志、慢 Trace 和高频告警越多，而此时平台本身最容易过载。生产设计必须保证它在异常流量下仍能提供足够证据。

## 1. 先画端到端数据路径

```text
Instrumentation
→ SDK Queue/Batch
→ Agent
→ Gateway
→ Backend Ingest
→ Queue/WAL/Object Storage
→ Query
→ Dashboard/Alert
```

对每一跳记录：容量单位、队列位置、最大长度、溢出策略、重试、超时、持久性、所有者和监控指标。只记录组件副本数，无法解释丢数据发生在哪里。

## 2. 三类基数并不相同

- **Metrics Cardinality**：时间序列 Label 组合数量；
- **Loki Stream Cardinality**：索引 Label Set 组合数量和变化速度；
- **Trace Attribute Cardinality**：影响搜索、指标生成与存储，但每个唯一值不一定直接成为独立序列。

危险字段包括用户 ID、Trace ID、Request ID、完整 URL、错误消息、Pod UID、模型请求 Prompt。处理方式不是全部删除，而是放到正确层级：稳定维度用于聚合，高基数身份只用于明细查询并设置保留和权限。

## 3. 各信号的容量模型

### 3.1 Metrics

```text
活跃序列数 ≈ 指标名 × 各 Label 实际组合数
样本/s ≈ 活跃序列数 ÷ scrape_interval
```

不要直接把每个 Label 唯一值相乘，实际组合受业务约束；但新增一个无界 Label 仍可能造成数量级增长。

### 3.2 Logs

```text
原始日志字节/s = 平均行大小 × 行数/s
对象存储量 ≈ 原始字节/s × 86400 × 保留天数 ÷ 压缩比
```

还需考虑 TSDB 索引、对象请求、WAL、缓存和副本。平均值不能覆盖事故时错误日志放大。

### 3.3 Traces

```text
Span/s = 请求/s × 每请求平均 Span 数
原始字节/s = Span/s × 平均 Span 字节
```

Tail Sampling 还要计算 `decision_wait` 内的 Trace/Span 缓存。异步长 Trace 和大属性会使平均值失效，需看 P95/P99 大小。

### 3.4 查询面

存得下不代表查得动。查询容量要单独测：并发、时间范围、扫描字节、对象请求、缓存命中、队列时间和取消率。

## 4. 背压、重试和恢复风暴

当出口慢于入口时只能发生四件事：排队、阻塞、丢弃或扩容，没有第五种魔法。

```text
净积压速率 = 生产速率 - 消费速率
填满时间 = 剩余队列容量 ÷ 净积压速率
```

恢复后若消费能力只等于当前生产速率，历史积压永远清不完。需要临时超额消费能力，并限制回放速率以免对象存储或后端再次崩溃。

指数退避和抖动可以减少同步重试，但重试必须有上限。成千上万 SDK、Agent 和 Gateway 同时重试会形成放大风暴。

## 5. 降级优先级

事故中不应让 DEBUG 日志挤掉错误证据。可定义：

```text
优先保留：告警指标、错误/慢 Trace、审计事件、平台自身遥测
可降级：成功请求明细、DEBUG 日志、低价值高频事件
```

降级策略要预先实现和演练。临时人工修改采样率时必须记录开始/结束时间，否则事后会把采样变化误认为业务变化。

## 6. 多租户隔离

租户隔离至少包括：身份、写入限流、查询公平、存储前缀/权限、保留和费用归属。

```text
客户端身份
→ 可信 Gateway 认证
→ 注入内部 Tenant ID
→ 后端按租户限流和授权
```

禁止仅依赖客户端可修改的 Header。为每租户设置写入速率、活跃 Series/Stream、查询并发、最长范围、采样和保留，避免 Noisy Neighbor。

## 7. 安全与隐私

- 传输链路使用 TLS/mTLS，证书可轮换；
- 后端、对象存储和队列使用最小权限及短期凭据；
- Prompt、Token、Cookie、SQL 参数和身份数据在源头限制；
- Collector 做第二层字段删除，但不把它当唯一防线；
- 调试端点、pprof、zPages 和管理 API 不对公网暴露；
- 查询、删除、配置变更和跨租户访问留审计；
- 保留、备份、对象版本和缓存都纳入删除合规。

遥测本身往往比业务库更集中地暴露系统结构与用户信息，不能被视为“只是运维数据”。

## 8. 升级策略

可观测性链路跨越 SDK、协议、Collector、后端、存储 schema、查询与仪表盘，不能一次全部升级。

建议顺序：

1. 阅读目标版本 Breaking Changes 和组件稳定级别；
2. 保存配置、容量和关键查询基线；
3. 在预生产回放真实数据分布；
4. 先升级少量无状态实例；
5. 验证字段、采样、丢弃、旧数据查询和告警；
6. 再滚动状态组件，遵守 Quorum、WAL 和存储格式要求；
7. 最后清理旧配置，并保留回退证据。

不要在同一窗口同时改变 Loki schema、部署模式和保留，也不要同时切换 Trace 后端与采样策略，否则出现差异无法归因。

## 9. 平台自身必须被监控

最小控制面指标：

- receiver accepted/refused；
- processor dropped；
- exporter sent/failed；
- queue capacity/size；
- retry 与 backend latency；
- 进程 CPU、RSS、GC、重启/OOM；
- Loki active streams、ingestion 429、chunk flush、query queue/scanned bytes；
- Trace ingest spans、queue lag、block build、search latency；
- 对象存储错误、请求延迟和容量；
- 数据新鲜度：最后成功写入到可查询的延迟。

平台自身遥测最好进入独立故障域或至少有应急保留路径，避免主后端故障时连诊断信息一起消失。

## 10. 通用故障决策树

### 10.1 数据完全缺失

```text
源是否产生？
├─ 否：Instrumentation/业务配置
└─ 是：Agent/SDK 是否 accepted？
   ├─ 否：连接、TLS、协议、队列
   └─ 是：Gateway 是否 accepted/sent？
      ├─ 否：Processor、内存、限流、出口
      └─ 是：Backend 是否摄入且时间/租户正确？
```

### 10.2 数据延迟

比较事件时间、Collector 接收时间、后端可查询时间，检查各层 Queue、WAL、Kafka Lag、Block/Chunk Flush 与对象存储。

### 10.3 查询变慢

区分排队时间和执行时间，再看范围、基数、扫描字节、解析/正则、缓存与对象存储。不要用扩容替代坏查询治理。

### 10.4 数据突增

先按租户、服务、版本、事件/Span 名称定位来源，再判断是真实业务峰值、错误循环、埋点重复、Label 爆炸还是重放。

## 11. 典型专项 Runbook

### 11.1 Collector 队列持续上涨

确认出口延迟/错误 → 后端限流与网络 → 当前生产/消费速率 → 剩余填满时间 → 启用预定降级或扩容 → 后端恢复后限制回放 → 核对丢弃与重复。

### 11.2 Tail Sampler OOM

确认 Trace/s、Span/Trace、Span 大小和 `decision_wait` → 检查路由是否集中倾斜 → 临时降低等待或策略复杂度 → 增加分片与内存 → 验证完整率变化。

### 11.3 Loki Stream 爆炸

定位新 Label/租户/版本 → 限制活跃 Stream 和写入 → 从采集配置移除高基数 Label → 等待旧 Stream/Chunk 生命周期结束 → 检查对象小文件和查询影响。

### 11.4 Tempo/Jaeger 摄入正常但搜不到

先用已知 Trace ID Lookup → 检查租户和时间 → 近期存储/Live Store → Block 构建或索引 → 对象/查询存储 → 属性搜索条件。已知 ID 能查而搜索不能查，优先查查询路径，不要重启接收端。

## 12. 证据包与恢复完成标准

事故期间保存：时间线、配置版本、组件版本、指标截图/原始查询、错误日志、队列和限流数、变更记录及唯一测试 ID。

恢复不只是告警变绿，还应满足：

```text
当前数据新鲜度恢复
积压归零或按计划下降
错误/丢弃停止增长
抽样数据端到端可查询
告警和仪表盘恢复
临时降级已记录并安排回滚
影响时间和缺失范围已量化
```

## 13. 练习与答案

**问题：后端恢复后队列不再增长，但也不下降，算恢复了吗？**

答案：没有。说明消费速率只追平当前生产速率，历史积压无法清理。需要安全提高消费能力或降低生产速率，并防止回放压垮后端。

**问题：可观测性平台是否应追求绝对零丢失？**

答案：需要按信号和合规分级。审计数据可能要求强持久性，DEBUG 日志则可在压力下丢弃。绝对目标必须转化为确认语义、队列时长、RPO/RTO 和演练，而不是口号。

参考资料：

- [OpenTelemetry Collector internal telemetry](https://opentelemetry.io/docs/collector/internal-telemetry/)
- [OpenTelemetry Collector resiliency](https://opentelemetry.io/docs/collector/resiliency/)
- [Loki operations](https://grafana.com/docs/loki/latest/operations/)
- [Tempo operations](https://grafana.com/docs/tempo/latest/operations/)
