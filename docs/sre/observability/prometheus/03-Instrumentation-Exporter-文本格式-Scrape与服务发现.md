---
title: "Instrumentation、Exporter、文本格式、Scrape 与服务发现"
sidebar_label: "03. 埋点、Exporter 与抓取"
sidebar_position: 3
description: "沿应用埋点、服务发现、Relabel、HTTP 抓取到样本入库讲清 Prometheus 指标采集路径。"
tags: [Prometheus, Instrumentation, Exporter, Scrape, Service Discovery]
---

# Instrumentation、Exporter、文本格式、Scrape 与服务发现

Prometheus 以 Pull 为主：服务发现产生 Target，Relabel 决定抓谁和附加什么目标标签，Prometheus 定期请求 `/metrics`，解析样本后写入 TSDB。

## 1. 三种指标来源

| 来源 | 用法 | 示例 |
| --- | --- | --- |
| 应用直接埋点 | 最接近业务语义 | 请求数、时延、队列长度 |
| Exporter | 把已有系统状态转换为指标 | node_exporter、数据库 Exporter |
| Pushgateway | 短生命周期批任务的折中 | 任务最后成功时间 |

Pushgateway 不是通用事件管道，也不应替代可抓取的长期服务。批任务推送后需要明确分组键与过期清理，否则旧指标会长期存在。

## 2. 一次 Scrape

```text
Service Discovery
→ target relabel_configs
→ HTTP GET /metrics
→ 解析OpenMetrics/Prometheus文本
→ 添加job/instance等Target Labels
→ metric_relabel_configs
→ 校验时间戳与样本
→ Head/WAL
```

Target Relabel 发生在抓取前，可用于选择地址、路径和保留目标；Metric Relabel 发生在样本抓取后，可删除高成本指标，但已经付出了网络和解析开销。

## 3. 文本暴露格式

```text
# HELP http_server_request_duration_seconds Request duration.
# TYPE http_server_request_duration_seconds histogram
http_server_request_duration_seconds_bucket{method="GET",le="0.1"} 120
http_server_request_duration_seconds_sum{method="GET"} 18.2
http_server_request_duration_seconds_count{method="GET"} 150
```

指标名、Label 名、类型和单位应稳定。Label 值不要使用用户 ID、Request ID、原始 URL 或错误堆栈。Exporter 每次抓取应有超时，并限制对被监控系统造成的查询成本。

## 4. 抓取失败分类

| Target 状态 | 检查 |
| --- | --- |
| 不在 Targets 页面 | 服务发现、Selector、Namespace、Relabel 被丢弃 |
| DNS/连接失败 | 地址、Service、Endpoint、NetworkPolicy |
| 401/403/TLS | Token、CA、SAN、认证配置 |
| Context deadline | Exporter 慢、目标慢、超时过短 |
| 解析失败 | 非法文本、重复 HELP/TYPE、时间戳问题 |
| `up=1` 但业务指标缺失 | 应用未走代码路径、Metric Relabel、版本变化 |

## 5. 验证实验

先用 `curl` 从 Prometheus 所在网络直接请求 Endpoint，再在 Targets 页面比较 Discovered Labels、最终 Labels 和 Last Error。故意制造 DNS、TLS、超时和格式错误，确认每类故障的证据位置。

```bash
promtool check metrics < metrics.txt
promtool check config prometheus.yml
```

`up` 只代表最近一次抓取是否成功，不代表业务健康；业务 SLI 必须来自应用指标。

参考：[Prometheus Exposition Formats](https://prometheus.io/docs/instrumenting/exposition_formats/)、[Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)。
