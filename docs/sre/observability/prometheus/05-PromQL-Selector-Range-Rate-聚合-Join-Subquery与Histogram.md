---
title: "PromQL：Selector、Range、Rate、聚合、Join、Subquery 与 Histogram"
sidebar_label: "05. PromQL 从选择器到 Histogram"
sidebar_position: 5
description: "建立 PromQL 类型与时间语义，掌握 Counter 速率、聚合、向量匹配、子查询和分位数计算。"
tags: [Prometheus, PromQL, rate, Histogram, Vector Matching]
---

# PromQL：Selector、Range、Rate、聚合、Join、Subquery 与 Histogram

PromQL 不是 SQL。它操作带 Label 的即时向量、范围向量、标量和字符串，并在明确的评估时间执行。先判断数据类型和 Label Set，再组合函数。

## 1. Selector 与时间

```promql
http_requests_total{job="api",code=~"5.."}
http_requests_total{job="api"}[5m]
```

第一条返回某个评估时点的即时向量，第二条返回每条时序最近 5 分钟的范围样本。Grafana 范围查询会在多个 Step 上重复执行即时表达式。

## 2. Counter 的速率

```promql
sum by (service) (rate(http_requests_total[5m]))
```

`rate` 能处理 Counter Reset，通常应先对每条原始 Counter 求 rate，再聚合。`irate` 只看最后两个点，适合观察尖峰，不适合稳定告警。窗口至少包含多个抓取样本。

## 3. 聚合与 Label

```promql
sum without (instance, pod) (rate(http_requests_total[5m]))
```

聚合会改变 Label Set。保留告警路由和下钻所需的 `cluster/service/namespace`，删除易变实例标签。没有明确维度的全局 Sum 会掩盖局部故障。

## 4. 向量匹配

```promql
rate(container_cpu_usage_seconds_total[5m])
  * on (namespace, pod) group_left(node)
    kube_pod_info
```

Join 的本质是 Label 匹配。必须确保一侧唯一，避免 many-to-many；`group_left/right` 不是消除重复数据的工具。先分别查询两侧 Label，再组合。

## 5. Histogram 分位数

经典 Histogram：

```promql
histogram_quantile(
  0.99,
  sum by (le, service) (rate(http_request_duration_seconds_bucket[5m]))
)
```

聚合时必须保留 `le`。分位数是从 Bucket 分布估算，不是平均值，也不能把多个客户端 Summary 分位数直接平均。

## 6. Subquery 与成本

```promql
max_over_time(
  sum by (service) (rate(http_requests_total[5m]))[1h:1m]
)
```

子查询适合对表达式结果再做时间函数，但范围大、Step 小、Series 多时查询成本很高。频繁 Dashboard/告警表达式应转为 Recording Rule。

## 7. 调试方法

1. 从最小 Selector 开始；
2. 查看原始样本和 Label；
3. 添加 rate/increase；
4. 再聚合；
5. 最后 Join 或 Subquery；
6. 检查空结果、重复结果、NaN 和查询耗时；
7. 用已知输入的规则测试固定预期。

参考：[Prometheus Querying Basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)、[Operators](https://prometheus.io/docs/prometheus/latest/querying/operators/)。
