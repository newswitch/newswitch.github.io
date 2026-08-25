---
title: "基数、采样、背压、容量、安全、多租户、升级与故障 Runbook"
sidebar_label: "15. 遥测平台生产 Runbook"
sidebar_position: 15
description: "统一处理 Collector、Loki、Tempo/Jaeger 的基数、采样、容量、安全、升级和生产故障。"
tags: [OpenTelemetry, Loki, Tempo, 容量规划, Runbook]
---

# 基数、采样、背压、容量、安全、多租户、升级与故障 Runbook

遥测平台必须做到“遥测故障不拖垮业务”。SDK、Agent 和 Gateway 的 Export 应异步、有界；后端不可用时允许受控降级，而不是无限阻塞业务线程或吃光节点内存。

## 1. 三类容量

```text
Logs/day = bytes_per_second × 86400 × retention × storage_overhead
Spans/day = spans_per_second × 86400 × avg_span_bytes × sampling_rate
Collector工作集 = ingress_rate × buffer_time × expansion_factor
```

还要计算 Loki Active Streams、Tempo Trace 大小、对象存储请求数、索引/Block、查询扫描量和 Compaction。小日志/小 Trace 也可能因对象请求和元数据产生高成本。

## 2. 基数与采样治理

- Resource/Label 禁止用户 ID、Request ID、完整路径；
- Loki Label 保持低基数，详情在正文；
- Span Attribute 可高于指标 Label，但仍设长度和数量限制；
- Head Sampling 控制总体成本；
- Tail Sampling 优先保留错误、慢请求和稀有流量；
- 日志对高频成功事件采样，但安全审计按合规要求完整保留。

## 3. 背压 Runbook

```text
后端5xx/429
→ Exporter重试/Queue增长
→ Collector内存接近限制
→ 拒绝/丢弃遥测
→ SDK/Agent出现发送失败
```

先确认业务未被同步 Export 拖慢；限制非关键遥测和高噪声 Tenant；恢复后端或对象存储；控制追赶速率；观察最老队列年龄和永久丢弃。不要同时无限增加队列和重试。

## 4. 多租户与安全

网关验证身份并注入不可伪造 Tenant，后端执行每租户写入、Stream/Trace、查询并发和保留限制。OTLP、Loki、Tempo API 使用 TLS，Secret 轮换，日志/Span 在入口脱敏。查询和审计记录谁访问了哪些 Tenant。

## 5. 升级原则

分别管理 Collector Distribution/组件、OTel Semantic Convention、Loki Schema、Tempo Block/架构、Helm Chart 和 Grafana Data Source。一次只升级一层，先回放固定遥测样本比较字段和查询，再灰度生产。属性重命名要有双读或转换窗口，但避免长期双写。

## 6. 故障决策树

```text
遥测缺失
├─ SDK未生成 → 埋点/采样/Flush
├─ Agent未收 → 端口/协议/权限/文件游标
├─ Collector拒绝 → 内存/队列/Processor/Exporter
├─ 后端写失败 → 限流、Ring、对象存储、Tenant
└─ 写入成功查不到 → 时间、Label/属性、索引、查询范围
```

## 7. 恢复验收

发送带唯一测试 ID 的 Log/Metric/Trace，确认三条 Pipeline 接收、导出、存储、查询和关联；验证队列追平、无持续丢弃、查询 P99 恢复、临时限流/Silence 回收。复盘量化遥测丢失窗口和业务发现延迟。

参考：[OpenTelemetry Collector Resiliency](https://opentelemetry.io/docs/collector/resiliency/)、[Loki Operations](https://grafana.com/docs/loki/latest/operations/)。
