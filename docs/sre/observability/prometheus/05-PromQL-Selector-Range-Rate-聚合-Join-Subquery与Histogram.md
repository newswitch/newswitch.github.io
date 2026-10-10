---
title: "PromQL：Selector、Range、Rate、聚合、Join、Subquery 与 Histogram"
sidebar_label: "05. PromQL 从选择器到 Histogram"
sidebar_position: 5
description: "从评估时间、数据类型和标签集合出发，系统掌握 Counter 速率、聚合、向量匹配、子查询、缺数据和 Histogram 分位数。"
tags: [Prometheus, PromQL, rate, Histogram, Vector Matching]
---

# PromQL：Selector、Range、Rate、聚合、Join、Subquery 与 Histogram

PromQL 不是 SQL。它不会遍历一张固定表，而是在某个评估时刻，从 TSDB 取出带 Label 的向量并执行运算。调试任何表达式前先回答三个问题：当前值是什么类型、每条结果保留什么 Label、表达式在哪些时间点被评估。

## 1. 四种值类型

| 类型 | 示例 | 说明 |
| --- | --- | --- |
| Instant Vector | `up{job="api"}` | 每条 Series 在评估时刻附近的一个样本 |
| Range Vector | `http_requests_total[5m]` | 每条 Series 在窗口内的一组样本 |
| Scalar | `10`、`scalar(...)` | 单个浮点值 |
| String | 字符串字面量 | 很少用于普通查询 |

范围向量不能直接与普通数字比较，必须先经过 `rate`、`increase`、`*_over_time` 等函数转换。

## 2. Instant Query 与 Range Query

```promql
rate(http_requests_total{service="order"}[5m])
```

Instant Query 在一个时间点求值。Grafana 展示 6 小时曲线时通常发送 Range Query，Prometheus 按 `start、end、step` 在许多评估点重复执行同一个表达式。

```text
面板范围6h，step=30s
→ 约720个评估时刻
→ 每个时刻读取各Series前5m样本
```

因此“单次 Instant 很快”不代表长时间面板也快。Step 过小会显著增加计算量，却不一定增加真实信息。

## 3. Selector、Matcher 与 Staleness

```promql
http_requests_total{job="api",code=~"5..",pod!=""}
```

- `=`/`!=`：精确匹配或排除；
- `=~`/`!~`：正则匹配或排除；
- 至少有一个 Matcher 不能匹配空字符串，避免无界选择；
- 广泛正则会扫描大量 Label 值和 Series。

目标停止上报后，旧样本不会永远作为当前值返回。Prometheus 使用 Lookback 与 Staleness 语义，让消失的 Series 退出即时向量。不要用最后值永久填充来掩盖 Target Down。

时间修饰符：

```promql
rate(http_requests_total[5m] offset 1h)
http_requests_total @ 1720000000
```

`offset` 用于相对时间对比，`@` 固定评估时间。同比前要考虑发布、业务周期和缺数据，不要把差异直接归因于故障。

## 4. Counter：rate、irate、increase 和 reset

```promql
sum by (cluster, service) (
  rate(http_requests_total{code=~"5.."}[5m])
)
```

`rate` 使用窗口内多个样本拟合每秒速率并处理 Counter Reset，适合告警和趋势；`irate` 只看最后两个样本，适合观察瞬时尖峰；`increase` 近似等于 `rate × 窗口秒数`，适合表达窗口增量。

正确顺序通常是先对每条原始 Counter 求 `rate`，再聚合：

```promql
sum(rate(requests_total[5m]))       # 推荐
rate(sum(requests_total)[5m:])      # 聚合后可能丢失单实例Reset信息
```

窗口至少覆盖多个 Scrape Interval。15 秒抓取使用 `[20s]` 容易因抖动空结果，`[2m]` 或 `[5m]` 更稳定。

## 5. Gauge 与时间窗口函数

```promql
max_over_time(queue_depth[15m])
avg_over_time(node_memory_available_bytes[5m])
quantile_over_time(0.95, request_queue_seconds[1h])
predict_linear(node_filesystem_free_bytes[6h], 24 * 3600)
```

Gauge 可以上升或下降，不应使用 Counter 的 `rate` 推导业务速率。`deriv`、`delta`、`predict_linear` 对数据规律有假设；磁盘突发清理、周期扩容或缺样本会让预测失真。

## 6. 聚合与结果标签

```promql
sum by (cluster, namespace, service) (
  rate(http_requests_total[5m])
)

sum without (instance, pod) (
  rate(http_requests_total[5m])
)
```

`by` 只保留指定维度，`without` 删除指定维度。告警结果至少保留路由和定位需要的稳定 Label；全局 Sum 会掩盖单集群或单租户故障，保留 Pod UID 又会制造告警抖动。

其他聚合：`count`、`min`、`max`、`avg`、`topk`、`bottomk`、`count_values`。平均百分比常常错误，应先把分子、分母分别求和后再相除。

## 7. 二元运算和向量匹配

默认只匹配 Label Set 完全一致的两侧 Series：

```promql
sum by (service) (rate(errors_total[5m]))
/
sum by (service) (rate(requests_total[5m]))
```

补充元数据：

```promql
rate(container_cpu_usage_seconds_total[5m])
  * on (namespace, pod) group_left(node)
    kube_pod_info
```

`on` 指定参与匹配的 Label，`ignoring` 排除 Label；`group_left/right` 表示多对一的方向并从“一”侧携带额外 Label。它不能解决 many-to-many 数据错误。

调试 Join：先分别执行两侧表达式，用 `count by (...)` 验证预期唯一键，再组合。遇到 many-to-many 时应修正键或预聚合，不能随意添加 `group_left`。

## 8. Set 运算与缺数据

`and`、`or`、`unless` 操作的是 Series 集合。常见缺数据判断：

```promql
absent(up{job="api"})
absent_over_time(http_requests_total{service="order"}[10m])
```

`or vector(0)` 可能把采集失败伪装为业务零值。只有零确实是缺失时的业务语义，并且 Label 能正确补齐时才使用。

## 9. Classic Histogram

经典 Histogram 产生 `_bucket`、`_sum`、`_count` Series。Bucket 为累计计数，因此 `le="1"` 已包含所有小于等于 1 秒的观察值。

```promql
histogram_quantile(
  0.99,
  sum by (service, le) (
    rate(http_request_duration_seconds_bucket[5m])
  )
)
```

聚合 Bucket 时必须保留 `le`。分位数是基于 Bucket 线性插值的估算，精度取决于 Bucket 边界；P99 位于 `+Inf` 前很宽的 Bucket 时结果意义有限。

平均延迟：

```promql
sum by (service) (rate(http_request_duration_seconds_sum[5m]))
/
sum by (service) (rate(http_request_duration_seconds_count[5m]))
```

## 10. Native Histogram

Native Histogram 以一个结构化样本保存稀疏 Bucket，可减少经典 Histogram 为每个固定 Bucket 建 Series 的成本，并支持可合并分位数。启用前确认抓取、Remote Write、长期存储和查询链路均兼容。

PromQL 对 Float Sample 和 Histogram Sample 的运算支持并不完全相同。升级后应为关键 Recording Rule 做回归测试，不能假设所有旧表达式自动等价。

## 11. Subquery

```promql
max_over_time(
  sum by (service) (rate(http_requests_total[5m]))[1h:1m]
)
```

子查询让一个即时向量表达式在过去 1 小时按 1 分钟 Step 重复求值，再由外层函数处理。长范围、小 Step、高基数和复杂 Join 会成倍扩大成本。频繁使用的表达式应下沉为 Recording Rule。

## 12. 调试和成本分析

固定流程：

1. 从最小 Selector 查看原始样本和 Label；
2. 确认指标类型、Scrape Interval 和是否 Reset；
3. 添加 `rate` 或窗口函数；
4. 再做聚合；
5. 分别验证 Join 两侧唯一性；
6. 检查空结果、NaN、`+Inf` 和缺数据；
7. 在实际时间范围和 Step 下测查询耗时；
8. 将高频重查询改为 Recording Rule。

```bash
curl -G 'http://prometheus:9090/api/v1/query' \
  --data-urlencode 'query=sum(rate(http_requests_total[5m]))'
```

Query Log、Engine 指标和 TSDB Status 用于确认慢在 Series 选择、样本解码还是计算，而不是凭表达式长度猜测。

## 13. 练习与答案

**问题：为什么 `rate(sum(counter)[5m:])` 可能隐藏 Reset？**

答案：不同实例的上升可能抵消某个实例归零，聚合后的序列不再保留每条原始 Counter 的独立生命周期。

**问题：P99 升高但平均值稳定是否矛盾？**

答案：不矛盾。少量长尾请求可能显著推高 P99，但对总体平均值影响有限。

**问题：查询结果为空时能否直接补 0？**

答案：不能。先区分无流量、目标消失、抓取失败、Label 不匹配和真正的零值。

## 14. 参考资料

- [PromQL Basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [PromQL Operators](https://prometheus.io/docs/prometheus/latest/querying/operators/)
- [PromQL Functions](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- [Histogram Practices](https://prometheus.io/docs/practices/histograms/)
