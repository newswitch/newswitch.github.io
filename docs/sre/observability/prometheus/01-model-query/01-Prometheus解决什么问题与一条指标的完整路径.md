---
title: "Prometheus 解决什么问题与一条指标的完整路径"
sidebar_label: "01. Prometheus 解决什么问题与指标路径"
sidebar_position: 1
description: "从应用埋点、服务发现、Scrape、TSDB、PromQL、规则计算到 Alertmanager 和 Grafana，建立一条指标的完整证据链。"
tags: [Prometheus, Scrape, TSDB, PromQL, Alertmanager]
---

# Prometheus 解决什么问题与一条指标的完整路径

Prometheus 用于收集和查询带时间戳的数值指标，并在规则满足时产生告警。它擅长回答“错误率什么时候开始升高、队列是否持续增长、哪个实例成为离群点”，但不保存完整请求内容，也不适合要求逐笔绝对准确的计费账本。

## 1. Prometheus 体系解决什么

- 采集应用、系统、中间件和设备指标；
- 通过 labels 表达实例、服务、状态码等维度；
- 使用 PromQL 计算速率、比例、分位数和聚合；
- 生成 Recording Rule 和 Alerting Rule；
- 将告警交给 Alertmanager 分组、抑制、路由和通知；
- 为 Grafana、自动化和容量系统提供查询接口；
- 在动态 Kubernetes 环境中自动发现 Target。

它不等于：

- 日志系统；
- 分布式 Trace 后端；
- 业务审计数据库；
- 绝对不丢样本的计费系统；
- 自动根因分析器。

## 2. 核心组件

| 组件 | 职责 |
| --- | --- |
| Client Library | 应用内创建和暴露指标 |
| Exporter | 将系统/中间件状态转换为 Prometheus 指标 |
| Prometheus Server | 服务发现、Scrape、TSDB、PromQL 和 Rules |
| Pushgateway | 适用于特定短生命周期批任务的中间推送点，不是通用事件入口 |
| Alertmanager | 告警分组、路由、抑制、Silence 和通知 |
| Grafana | 查询和可视化，不是指标事实源 |
| Remote Storage | 接收 Remote Write 或提供长期/全局查询能力 |

## 3. 一条指标的完整路径

以 HTTP 请求 Counter 为例：

```text
1. 应用处理请求
2. Client Library增加http_requests_total
3. /metrics暴露当前累计值
4. Service Discovery发现Target
5. Relabel决定最终Target和Labels
6. Prometheus按scrape_interval请求/metrics
7. 解析样本并追加到Head/WAL
8. Head数据形成持久Block并Compaction
9. PromQL选择并计算时序
10. Rule按evaluation_interval执行
11. Alerting Rule进入Pending/Firing
12. Prometheus发送Alert给Alertmanager
13. Alertmanager分组、抑制、路由和通知
14. Grafana查询并展示相同数据
```

任一阶段失败都会产生不同现象。

## 4. 应用怎样产生指标

应用内通常维护当前聚合状态，而不是为每个请求保存一行：

```text
http_requests_total{method="GET",code="200"} 125030
http_requests_total{method="GET",code="500"} 203
```

Counter 暴露的是进程启动以来的累计值。Prometheus 定期抓取这些快照，用 `rate()` 计算时间窗口内每秒增量。

如果应用重启，Counter 会归零；`rate()` 能处理常见 reset。直接用两个 Counter 当前值相减容易得到错误负数。

## 5. Exporter 做什么

无法直接暴露 Prometheus 指标的系统可通过 Exporter：

```text
Prometheus
→ Exporter /metrics
→ Exporter查询MySQL、Node、GPU或其他系统
→ 转换成指标
```

典型 Exporter：

- node_exporter；
- mysqld_exporter；
- blackbox_exporter；
- kube-state-metrics；
- DCGM Exporter；
- 应用或中间件原生 `/metrics`。

Exporter 正常不代表被监控系统正常。应同时监控 Exporter 自身抓取错误和目标系统指标。

## 6. 服务发现怎样变成 Target

静态配置可直接写地址，Kubernetes 中通常通过 API 发现 Pod、Service、Endpoint 或 Node，再经 Relabel 选择和修改标签：

```text
Kubernetes API返回候选对象
→ Discovery Labels (__meta_kubernetes_*)
→ relabel_configs过滤、替换、保留/删除
→ 形成最终Target URL和Target Labels
→ Scrape
→ metric_relabel_configs过滤样本/标签
```

`relabel_configs` 在抓取前处理 Target；`metric_relabel_configs` 在抓取后、写入前处理样本。混淆两者会导致 Target 消失或无界指标进入 TSDB。

## 7. 一次 Scrape 发生什么

Prometheus 根据 `scrape_interval` 和 `scrape_timeout` 请求 Target。成功抓取需要：

- DNS/网络可达；
- 协议、TLS、认证正确；
- `/metrics` 在 timeout 内返回；
- 内容格式可解析；
- 样本和标签合法；
- Target 没有超过 Sample/Label 限制。

Prometheus 自动生成：

```text
up{job="...",instance="..."}
scrape_duration_seconds
scrape_samples_scraped
scrape_samples_post_metric_relabeling
scrape_series_added
```

`up=1` 只表示本次抓取成功，不代表应用的业务接口可用。

## 8. 样本怎样写入 TSDB

```text
Scrape Samples
→ Head内存结构
→ WAL顺序追加
→ Head切出持久Block
→ Compaction合并Block
→ Retention删除过期Block
```

WAL 帮助 Prometheus 重启后恢复尚未形成持久 Block 的近期数据。启动日志中的 WAL Replay 时间会影响监控恢复速度。

高 active series、高 samples/s、长 retention 和高查询并发会同时影响内存、磁盘、CPU 和启动时间。

## 9. PromQL 怎样读取

Instant Query 在一个时间点返回向量；Range Query 在时间范围内按步长多次计算。

```promql
rate(http_requests_total{code=~"5.."}[5m])
```

这条查询：

1. 选择 `http_requests_total`；
2. 过滤 5xx；
3. 读取每条时序最近 5 分钟样本；
4. 处理 Counter Reset；
5. 计算每秒平均增长速率。

Grafana 的一张图可能对每个面板执行多次 Range Query。面板过多、时间范围过大和步长过小会形成查询压力。

## 10. Rule 怎样产生告警

Prometheus 按 `evaluation_interval` 执行规则：

```yaml
groups:
  - name: api
    rules:
      - alert: APIHighErrorRate
        expr: |
          sum(rate(http_requests_total{code=~"5.."}[5m]))
          /
          sum(rate(http_requests_total[5m])) > 0.05
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: API error rate is high
```

状态：

```text
Inactive
→ 条件满足：Pending
→ 持续满足for：Firing
→ 条件恢复：Resolved
```

`for` 防止瞬时抖动，但设置过长会延迟真实事故。应以 SLO 消耗速度和业务影响设计，而不是统一写 5 分钟。

## 11. Alertmanager 做什么

Prometheus 负责判断“告警是否成立”，Alertmanager 负责“告警如何通知”：

- 按 labels 分组；
- 去重多个 Prometheus 副本发送的同一告警；
- 根据路由树发送到不同团队；
- inhibition 抑制下游告警；
- Silence 在维护窗口静默；
- 控制 group_wait、group_interval、repeat_interval；
- 渲染通知模板。

Alertmanager 不保存 Prometheus 指标，也不重新计算告警表达式。

## 12. Grafana 在哪里

Grafana 通过 Prometheus HTTP API 执行 PromQL：

```text
Browser
→ Grafana
→ Prometheus query/query_range
→ TSDB/Query Engine
→ 返回Series
→ Panel渲染
```

Dashboard 是观察入口，不应成为唯一的规则来源。核心告警和 Recording Rule 应进入 Git、测试和变更流程。

## 13. Pull 模型的边界

Pull 优点：

- Prometheus 控制抓取频率和超时；
- 可以从 Target 页直接调试；
- 服务发现与 Target 健康统一；
- 监控系统不依赖应用主动保持发送连接。

边界：

- 短于 Scrape Interval 的瞬态值可能看不到；
- 目标在两次抓取之间退出，最后状态可能缺失；
- 防火墙和网络拓扑必须允许 Prometheus 访问 Target；
- 每请求明细不适合做指标标签；
- Pushgateway 只适用于特定批任务，不应替代通用事件/日志系统。

## 14. 故障定位表

| 现象 | 优先检查 |
| --- | --- |
| Target 不出现 | Service Discovery、Selector、RBAC、Relabel |
| Target Down | DNS、网络、TLS、认证、端口、timeout、格式 |
| Target Up 但指标缺失 | 应用埋点、metric relabel、路径、Feature Flag |
| 查询为空 | Selector、时间范围、staleness、label 值 |
| 告警不触发 | 表达式、rule load、evaluation、`for` |
| 告警触发不通知 | Alertmanager route、receiver、inhibit、silence |
| Grafana 慢 | 查询时间范围、step、panel 数、Prometheus 查询负载 |
| 重启很慢 | WAL replay、active series、磁盘性能 |

## 15. 课后实验

1. 编写一个 Counter 并暴露 `/metrics`；
2. 配置静态 Target，观察 `up` 和 scrape 指标；
3. 修改路径造成 404，定位 Target Down；
4. 写 PromQL 计算请求速率和错误率；
5. 创建带 `for` 的规则并查看 Pending/Firing；
6. 让 Alertmanager 路由到测试 Receiver；
7. 重启应用观察 Counter Reset；
8. 重启 Prometheus 观察 WAL Replay。

## 16. 参考资料

- [Prometheus Overview](https://prometheus.io/docs/introduction/overview/)
- [Prometheus Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Prometheus Alerting Overview](https://prometheus.io/docs/alerting/latest/overview/)
- [Alertmanager Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
