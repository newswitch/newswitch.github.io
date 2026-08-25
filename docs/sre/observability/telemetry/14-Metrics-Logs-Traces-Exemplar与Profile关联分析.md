---
title: "Metrics、Logs、Traces、Exemplar 与 Profile 关联分析"
sidebar_label: "14. 四类信号关联分析"
sidebar_position: 14
description: "从 SLO 指标下钻到 Exemplars、Trace、日志和 Profile，建立跨信号故障证据链。"
tags: [Metrics, Logs, Traces, Exemplar, Profiling, 关联分析]
---

# Metrics、Logs、Traces、Exemplar 与 Profile 关联分析

四类信号回答不同问题：指标发现范围和趋势，Trace 还原单次因果链，日志提供离散上下文，Profile 解释 CPU/内存消耗在哪里。正确路径通常从低成本聚合信号逐层下钻。

## 1. 关联键

| 信号 | 推荐关联字段 |
| --- | --- |
| Metrics | cluster、service、namespace、operation |
| Exemplar | 指标样本附近的 Trace ID |
| Trace | Trace ID、Span ID、Resource |
| Logs | Trace ID、Span ID、Request ID、Service |
| Profile | Service、Instance、时间、版本，可选 Span 关联 |

不要把 Trace ID 变成普通 Prometheus Label；Exemplar 在 Histogram 等样本旁保存少量引用，不创建每请求时序。

## 2. 标准下钻

```text
SLO燃烧率告警
→ Grafana查看受影响service/operation
→ Histogram Exemplar打开慢Trace
→ 找关键路径慢Span
→ 用Trace ID查结构化日志
→ 在同时间/实例打开CPU或内存Profile
→ 验证根因和影响范围
```

如果没有 Exemplar，可用服务、时间窗口、版本和 Request ID 缩小范围，但关联精度更低。

## 3. Profile 的位置

持续 Profiling 聚合函数栈的 CPU、内存或其他资源消耗。Trace 告诉你“哪个请求慢”，Profile 告诉你“该时间段哪些代码消耗资源”。二者时间和服务标签必须一致，采样开销也要基准测试。

## 4. AI 推理示例

```text
TTFT P99上升
├─ Metrics：排队时间升高，GPU利用率仅30%
├─ Trace：请求长时间停在scheduler queue
├─ Logs：KV Cache不足触发等待
└─ Profile：CPU tokenizer并非热点
```

由此可以把问题定位到调度/KV Cache 容量，而不是看到 GPU 利用率低就直接扩 GPU。关联分析必须以共同时间和请求样本验证。

## 5. 常见断链

- Resource `service.name` 在不同信号中不一致；
- Trace 被采样掉但日志保留；
- 时钟漂移导致时间窗口不重叠；
- Grafana Data Source 派生字段配置错误；
- 入口代理重写 Request ID；
- 日志脱敏误删 Trace ID。

## 6. 验收

主动制造一个慢请求，从告警链接完成 Metric → Exemplar → Trace → Logs → Profile 的全链路，并记录所需点击、查询时长和缺失率。目标是值班人员无需记忆后端细节即可获得证据。

参考：[Prometheus Exemplars](https://prometheus.io/docs/prometheus/latest/feature_flags/#exemplars-storage)、[OpenTelemetry Signals](https://opentelemetry.io/docs/concepts/signals/)。
