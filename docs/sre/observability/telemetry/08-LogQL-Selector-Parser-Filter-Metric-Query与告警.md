---
title: "LogQL Selector、Parser、Filter、Metric Query 与告警"
sidebar_label: "08. LogQL 查询与告警"
sidebar_position: 8
description: "从 Stream Selector 到日志过滤、Parser、Unwrap、Metric Query 和告警，建立可解释、成本受控的 LogQL 查询方法。"
tags: [Loki, LogQL, 日志查询, 告警, Grafana]
---

# LogQL Selector、Parser、Filter、Metric Query 与告警

LogQL 的关键不是记住语法，而是理解执行顺序：先用索引选 Stream，再扫描 Chunk、过滤日志行、解析字段，必要时把日志转换成时间序列。

## 1. 两类查询

**日志查询**返回日志行：

```logql
{cluster="prod", namespace="orders", service="order-api"}
  |= "payment"
  | json
  | level="ERROR"
```

**Metric Query**把日志窗口聚合成数值：

```logql
sum by (service) (
  rate({cluster="prod", namespace="orders"} | json | level="ERROR" [5m])
)
```

Metric Query 不是 Prometheus 原始指标。它在查询时读取和计算日志，宽范围查询可能比直接使用应用指标昂贵。

## 2. Stream Selector 是强制入口

```logql
{namespace="orders", service=~"order-api|payment-api"}
```

常见匹配器：

- `=`：精确相等，通常最可控；
- `!=`：不等于；
- `=~`：正则匹配；
- `!~`：正则排除。

至少使用一个能有效缩小范围的匹配器。`{service=~".*"}` 几乎等于全租户扫描，不能因为语法合法就作为仪表盘默认查询。

## 3. 行过滤应尽量靠前

```logql
|= "timeout"       # 包含纯文本
!= "healthcheck"   # 不包含纯文本
|~ "status=5.."    # 正则包含
!~ "debug|trace"   # 正则排除
```

纯文本过滤通常比正则便宜。如果某个固定词能先排除 99% 日志，应先过滤再执行 JSON 或正则解析：

```logql
{service="order-api"}
  |= "payment failed"
  | json
  | duration_ms > 3000
```

## 4. Parser：把正文变成临时 Label

### 4.1 JSON 与 logfmt

```logql
{service="order-api"} | json | status_code >= 500
```

```logql
{service="gateway"} | logfmt | method="POST" and duration_ms > 1000
```

解析产生的是查询期间可用的字段，不等于写入时索引 Label，因此不会为历史数据创建新 Stream。

### 4.2 Pattern 与 regexp

```logql
{service="nginx"}
  | pattern `<ip> - - [<_>] "<method> <path> <_>" <status> <bytes> <_>`
  | status >= 500
```

`pattern` 对固定格式通常更易读；只有结构无法表达时再使用 `regexp`。正则必须先在小时间范围测试，避免回溯和扫描放大。

### 4.3 处理解析错误

解析失败会生成 `__error__` 等错误标签。Metric Query 中未处理的错误可能让查询失败或结果失真：

```logql
{service="order-api"}
  | json
  | __error__=""
  | unwrap duration_ms
```

不要一律丢弃错误。先单独统计解析错误比例，因为格式漂移可能意味着某个版本已经改变日志协议。

## 5. 格式化不是过滤

```logql
| line_format `{{.method}} {{.path}} status={{.status}} duration={{.duration_ms}}ms`
```

`line_format` 改变展示内容，不减少前面已经发生的扫描。`label_format` 用于重命名或计算临时字段，也不应拿来制造无限基数的聚合维度。

## 6. 从日志生成指标

### 6.1 事件速率

```logql
sum by (service) (
  rate({namespace="orders"} |= "payment failed" [5m])
)
```

### 6.2 窗口计数

```logql
sum(count_over_time({service="order-api"} | json | level="ERROR" [10m]))
```

### 6.3 提取数值

```logql
quantile_over_time(
  0.99,
  {service="order-api"}
    | json
    | __error__=""
    | unwrap duration_ms [5m]
) by (route)
```

`unwrap` 将解析字段变成样本值。单位必须统一，字符串 `"3s"`、数字 `3000` 和带后缀字节数不能未经验证混合。

### 6.4 字节与吞吐

```logql
sum by (service) (
  bytes_rate({namespace="orders"}[5m])
)
```

这反映日志字节速率，不是业务网络吞吐。

## 7. 告警设计

日志告警适合检测明确事件，例如证书加载失败、备份校验失败、配置拒绝生效。已有稳定数值指标时，优先用指标告警，因为成本更低、语义更稳定。

示例：5 分钟内某服务出现最终支付失败：

```logql
sum by (service) (
  count_over_time(
    {cluster="prod", service="payment-api"}
      | json
      | event_name="payment.final_failed"
      | __error__="" [5m]
  )
) > 0
```

告警必须包含租户、集群、服务、查询窗口和 Runbook。不要对任意 `ERROR` 直接告警，否则重试日志会造成噪声。

## 8. 查询性能诊断

查询慢时依次检查：

1. 时间范围是否过大；
2. Selector 命中了多少 Stream；
3. 是否能用精确匹配替代正则；
4. 行过滤是否位于 Parser 之前；
5. 扫描了多少字节和 Chunk；
6. 查询是在排队、对象存储慢，还是执行 CPU 高；
7. 仪表盘是否以高频刷新重复执行昂贵查询。

可使用 `logcli` 保存真实查询和统计信息，避免只凭 Grafana 页面体感：

```bash
logcli query \
  '{cluster="prod",namespace="orders",service="order-api"} |= "timeout"' \
  --since=30m \
  --stats
```

## 9. 一条查询的构建方法

先回答“在哪个稳定范围”：

```logql
{cluster="prod", namespace="orders", service="order-api"}
```

再回答“哪类日志”：

```logql
|= "upstream"
```

然后解析和验证：

```logql
| json | __error__="" | status_code >= 500
```

最后才格式化、聚合或告警。每增加一步都在短时间范围验证命中量和解析错误。

## 10. 练习与答案

**问题：为什么下面的查询很危险？**

```logql
{namespace=~".*"} | regexp `(?P<id>[0-9a-f-]{36})`
```

答案：Selector 几乎没有缩小 Stream，后端需要扫描大量 Chunk，并对每行执行正则。应先限定集群、命名空间和服务，再用固定文本过滤，最后解析。

**问题：日志产生的 P99 能替代业务直方图吗？**

答案：通常不能完全替代。日志可能采样、丢失、格式漂移，查询还需实时扫描；业务 Histogram 具有稳定桶和更低成本。LogQL P99 更适合临时分析或尚无指标的过渡场景。

参考资料：

- [LogQL documentation](https://grafana.com/docs/loki/latest/query/)
- [Log queries](https://grafana.com/docs/loki/latest/query/log_queries/)
- [Metric queries](https://grafana.com/docs/loki/latest/query/metric_queries/)
