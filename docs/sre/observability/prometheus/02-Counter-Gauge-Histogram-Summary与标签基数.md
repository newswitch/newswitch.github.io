---
title: "Counter、Gauge、Histogram、Summary 与标签基数"
sidebar_label: "02. 指标类型与标签基数"
sidebar_position: 2
description: "掌握 Prometheus 指标类型、时序身份、Counter Reset、Histogram 分位数、Summary 边界以及高基数治理。"
tags: [Prometheus, Counter, Gauge, Histogram, Summary, Cardinality]
---

# Counter、Gauge、Histogram、Summary 与标签基数

Prometheus 存储的核心不是“一个指标名”，而是一组由 metric name 和完整 label set 唯一标识的时间序列。指标类型选择错误会产生错误查询，标签设计错误则可能直接耗尽监控系统内存和磁盘。

## 1. 时间序列身份

下面是三条不同时间序列：

```text
http_requests_total{method="GET",code="200",instance="api-1"}
http_requests_total{method="GET",code="500",instance="api-1"}
http_requests_total{method="GET",code="200",instance="api-2"}
```

唯一身份是：

```text
metric name + 所有labels
```

任意 label value 变化都会产生新时序。标签不是普通日志字段。

## 2. Counter

Counter 只增加或在进程重启时归零，适合累计事件：

- 请求数；
- 错误数；
- 处理 token 数；
- 消息发送/消费数；
- OOM、重试或 Cache Miss 次数。

命名通常使用 `_total`：

```text
http_requests_total
model_output_tokens_total
```

常用查询：

```promql
rate(http_requests_total[5m])
increase(http_requests_total[1h])
```

`rate` 适合画每秒速率；`increase` 适合解释时间窗内大致增加量。两者都能处理常见 Counter Reset。

错误做法：

```promql
http_requests_total - http_requests_total offset 5m
```

进程重启时可能产生负值，也没有正确处理边界外推。

## 3. Gauge

Gauge 可上升也可下降，表示当前状态：

- 内存使用量；
- 队列深度；
- 运行请求数；
- 温度；
- 当前副本数；
- KV Cache 使用率。

```text
queue_messages_ready 1200
gpu_temperature_celsius 67
```

Gauge 通常直接查询、聚合或使用时间函数：

```promql
max_over_time(gpu_temperature_celsius[30m])
avg_over_time(queue_messages_ready[10m])
```

不要对普通 Gauge 使用 `rate()` 来解释吞吐，除非确实要计算 Gauge 的变化速度并理解结果语义。

## 4. Histogram

Histogram 在客户端把观测值累计到一组 bucket，并产生：

```text
http_request_duration_seconds_bucket{le="0.1"}
http_request_duration_seconds_bucket{le="0.5"}
http_request_duration_seconds_bucket{le="1"}
http_request_duration_seconds_bucket{le="+Inf"}
http_request_duration_seconds_sum
http_request_duration_seconds_count
```

Classic Histogram 的 bucket 是累计的：`le="1"` 包含所有小于等于 1 秒的观测。

计算平均值：

```promql
sum(rate(http_request_duration_seconds_sum[5m]))
/
sum(rate(http_request_duration_seconds_count[5m]))
```

计算 P95：

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)
```

需要保留维度时：

```promql
histogram_quantile(
  0.95,
  sum by (le, model) (rate(llm_ttft_seconds_bucket[5m]))
)
```

## 5. Bucket 怎样选择

Bucket 决定可观测分辨率和时序数量。若 SLO 是 1 秒和 3 秒，Bucket 应在这些边界附近提供足够分辨率。

错误例子：

```text
Buckets: 0.1, 10, 100 seconds
SLO: 1 second
```

P95 落在 0.1 到 10 之间时插值非常粗糙。

Bucket 越多，每组标签产生的时序越多：

```text
时序数 ≈ label组合数 × (bucket数 + sum + count)
```

所以不能为每个用户、URL 和模型副本同时配置几十个 Bucket。

## 6. Native Histogram

较新 Prometheus 和客户端支持 Native Histogram，以更高效的结构表达更宽动态范围，但功能稳定性、存储、Remote Write 和查询兼容取决于部署版本。

引入前要验证：

- Prometheus 和客户端版本；
- Feature/配置状态；
- Remote Storage 支持；
- Grafana 与规则表达式；
- Classic 与 Native 的迁移和重复采集；
- 容量变化。

## 7. Summary

Summary 通常在客户端计算 quantile，并暴露 `_sum`、`_count` 和预计算分位数。

优点：

- 客户端直接计算目标分位数；
- 不需要预先设计 Bucket。

主要边界：

- 客户端分位数通常不能跨实例正确聚合；
- 分位数窗口和误差在客户端固定；
- 调整目标需要改应用；
- 客户端计算有成本。

分布式服务通常优先 Histogram，因为可在 Prometheus 端跨实例聚合。Summary 的 `_sum` 和 `_count` 仍可聚合计算平均值。

## 8. 为什么不能平均 P95

错误：

```promql
avg(instance_p95)
```

每个实例的请求量和分布不同，分位数本身不可直接平均。正确做法是聚合 Histogram Bucket，再计算整体 quantile。

## 9. Label 应该放什么

适合标签：

- method；
- status class/code（有限集合）；
- service、namespace、cluster；
- model、version；
- operation；
- bounded error type；
- region/zone。

危险标签：

- user ID；
- request ID、trace ID；
- URL 完整路径；
- IP；
- 时间戳；
- SQL 原文；
- Prompt 或对象名称；
- Kubernetes Pod UID 在长期高 churn 环境中无限保留。

高基数标识应放日志、Trace 或 Exemplar，不应成为普通指标 label。

## 10. 基数怎样相乘

假设：

```text
10 services
× 20 instances
× 8 status codes
× 50 endpoints
× 20 histogram series
= 1,600,000 series
```

实际还会乘环境、区域、模型、租户等维度。设计指标前必须估算组合，而不是上线后等 Prometheus OOM。

## 11. 动态路径规范化

不要使用：

```text
path="/users/123456/orders/987"
```

应在应用路由层暴露模板：

```text
route="/users/:id/orders/:order_id"
```

如果框架无法取得路由模板，宁可减少标签，也不要对 URL 使用不可靠正则产生大量变体。

## 12. Missing Label 与空值

```text
metric{zone=""}
metric
```

这是不同 label set，查询和聚合表现可能不同。Instrumentation 应定义标签是否必填，并避免同一指标在不同代码路径暴露不同 label names。

客户端库通常要求同一个 Collector 使用固定标签集合。

## 13. Staleness 与目标消失

Target 停止暴露某条时序后，Prometheus 不会永远使用最后一个值。经过 staleness 处理后，该时序会从即时查询中消失。

因此：

- 实例下线后 Gauge 不会永久停留；
- 查询缺失和数值 0 不同；
- 告警要决定缺失数据是否也是故障；
- 使用 `absent()`/`absent_over_time()` 时要理解 label 推导。

## 14. 指标命名和单位

建议：

- 使用基础单位，如 seconds、bytes；
- 单位放在名称后缀；
- Counter 使用 `_total`；
- 名称表达测量对象和含义；
- 不把单位混在 label value；
- 不在一个指标里混合不同语义。

示例：

```text
http_request_duration_seconds
process_resident_memory_bytes
model_output_tokens_total
```

## 15. AI 服务指标示例

| 指标 | 类型 | 说明 |
| --- | --- | --- |
| `llm_requests_total` | Counter | 请求总数，按有限状态分类 |
| `llm_ttft_seconds` | Histogram | 首 token 延迟 |
| `llm_inter_token_latency_seconds` | Histogram | token 间延迟 |
| `llm_queue_requests` | Gauge | 当前等待请求 |
| `llm_kv_cache_usage_ratio` | Gauge | KV Cache 当前比例 |
| `llm_input_tokens_total` | Counter | 输入 token 总量 |
| `llm_output_tokens_total` | Counter | 输出 token 总量 |

不要给这些指标增加 request_id 或完整 prompt label。

## 16. 基数治理流程

```text
指标设计评审
→ 估算label组合和Histogram倍数
→ 设置scrape sample/label限制
→ 监控active series和series churn
→ 定期查高基数metric/label
→ metric relabel止损
→ 修复Instrumentation
```

`metric_relabel_configs` 可临时丢弃高风险指标，但会造成可观测数据缺口，应记录变更并推动源端修复。

## 17. 课后实验

1. 暴露 Counter 并重启进程，比较直接差值和 `rate`；
2. 暴露 Gauge 并观察上升/下降；
3. 为请求延迟设计与 SLO 对齐的 Bucket；
4. 用 Histogram 计算平均值和 P95；
5. 给指标加入随机 request ID，观察时序增长后立即移除；
6. 对两个实例分别计算 Summary P95，解释为何不能平均；
7. 停止暴露一条指标，观察 staleness 和 `absent_over_time`。

## 18. 参考资料

- [Prometheus Data Model](https://prometheus.io/docs/concepts/data_model/)
- [Prometheus Metric Types](https://prometheus.io/docs/concepts/metric_types/)
- [Prometheus Instrumentation Practices](https://prometheus.io/docs/practices/instrumentation/)
- [Prometheus Histograms and Summaries](https://prometheus.io/docs/practices/histograms/)
