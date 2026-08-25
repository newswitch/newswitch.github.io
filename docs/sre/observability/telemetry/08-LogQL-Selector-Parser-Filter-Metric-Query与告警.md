---
title: "LogQL Selector、Parser、Filter、Metric Query 与告警"
sidebar_label: "08. LogQL 查询与告警"
sidebar_position: 8
description: "从 Stream Selector 到解析、过滤和日志指标，建立高效、可验证的 LogQL 查询方法。"
tags: [Loki, LogQL, Parser, Metric Query, 告警]
---

# LogQL Selector、Parser、Filter、Metric Query 与告警

LogQL 查询应先用低基数 Label Selector 缩小 Stream，再对日志正文执行字符串、JSON、Logfmt 或正则解析。把昂贵正则放在全局扫描前面会显著放大成本。

## 1. 查询管道

```logql
{cluster="prod", app="checkout"}
  |= "payment"
  | json
  | severity="ERROR"
  | duration_ms > 1000
```

执行思路是：选 Stream → 低成本文本过滤 → 解析字段 → 字段过滤 → 格式化。解析失败可通过错误标签/状态检查，避免把坏日志悄悄算入结果。

## 2. 常用 Parser

| Parser | 适用 |
| --- | --- |
| `json` | 单行结构化 JSON |
| `logfmt` | `key=value` 文本 |
| `regexp` | 无结构但格式稳定的少量日志 |
| `pattern` | 按固定结构提取，通常比复杂正则易维护 |

解析出的字段是查询期 Label，不等同于索引 Label。高基数字段可以用于当前查询，但范围太大仍会消耗 CPU。

## 3. Metric Query

```logql
sum by (app) (
  rate({cluster="prod"} |= "ERROR" [5m])
)
```

可以从日志计算错误率、字节率和提取数值的分位数。用于告警时要保证日志采集可靠、时间戳正确并设置最小流量；核心 SLI 更适合应用原生指标，日志指标作为补充证据。

## 4. 告警设计

错误日志突增、特定崩溃签名和审计事件适合 LogQL 告警。告警 Label 保持低基数，详细 Request ID 放 Annotation 链接中。使用 Recording Rule 预计算重复的高成本日志查询。

## 5. 查询优化

- 缩短时间范围并限定 Cluster/App；
- 用 `|=`/`!=` 先过滤，再解析或正则；
- 避免空 Selector 和 `.*`；
- 调整 Query Split、并发与缓存；
- 限制单 Tenant 查询资源；
- 为常用错误字段改进结构化日志，而不是堆复杂正则。

## 6. 验收

准备正常、错误、解析失败和超长日志，编写查询分别统计错误率与 P95 时延；比较“先正则”和“先精确过滤”的扫描量与耗时。最后中断日志采集，验证告警不会把无数据误判为零错误。

参考：[LogQL](https://grafana.com/docs/loki/latest/query/)。
