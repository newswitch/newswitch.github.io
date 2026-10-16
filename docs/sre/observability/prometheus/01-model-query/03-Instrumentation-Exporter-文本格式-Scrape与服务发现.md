---
title: "Instrumentation、Exporter、暴露格式、Scrape 与服务发现"
sidebar_label: "03. 埋点、Exporter 与抓取链路"
sidebar_position: 3
description: "从应用埋点和 Exporter 开始，跟踪指标经过 HTTP 协商、服务发现、Relabel、Scrape 和样本校验进入 Prometheus 的完整路径。"
tags: [Prometheus, Instrumentation, Exporter, Scrape, Service Discovery, Relabel]
---

# Instrumentation、Exporter、暴露格式、Scrape 与服务发现

监控链路的第一步不是安装 Grafana，而是把系统状态转换成语义稳定、基数受控的指标。Prometheus 的一次抓取可拆成两条路径：控制路径负责找到目标，数据路径负责从目标取得并接收样本。

```text
控制路径：服务发现 → Target Relabel → Target Pool
数据路径：HTTP请求 → 格式协商 → 解析样本 → Metric Relabel → TSDB
```

如果 Targets 页面没有目标，应查控制路径；目标存在但 `DOWN`，应查 HTTP/TLS/认证和格式；目标 `UP` 但查询不到某指标，应查 Metric Relabel、时间戳和查询标签。

## 1. 应用埋点与 Exporter 的边界

应用能够直接观察请求、队列和业务状态时，应使用官方 Client Library 埋点：

```text
应用代码
├─ Counter：请求数、错误数、完成任务数
├─ Gauge：队列长度、在途请求、温度
├─ Histogram：延迟、请求体大小、批次大小
└─ /metrics：按协商格式暴露当前累计状态
```

Exporter 适合无法修改的系统。它读取内核接口、管理 API 或状态文件，再转换为 Prometheus 指标，例如 Node Exporter、mysqld_exporter 和 Blackbox Exporter。

Exporter 不是数据仓库，也不应每次抓取执行代价不可控的全表扫描。采集操作必须有超时、并发限制和失败指标，否则监控可能反过来压垮被监控系统。

## 2. 一个最小指标端点

文本响应示例：

```text
# HELP api_requests_total Total API requests.
# TYPE api_requests_total counter
api_requests_total{method="GET",route="/orders",code="200"} 18420
api_requests_total{method="GET",route="/orders",code="500"} 23
# HELP api_inflight_requests Current in-flight requests.
# TYPE api_inflight_requests gauge
api_inflight_requests 7
```

关键规则：

- 同一指标名称的所有样本应具有一致语义和类型；
- Label 名称和值必须正确转义，样本值为合法数字；
- Counter 在进程重启后可以归零，查询侧使用 `rate` 识别 Reset；
- 不主动写客户端时间戳，让 Prometheus 记录抓取时刻；
- 不使用用户 ID、请求 ID、完整 URL 等无界 Label；
- HELP/TYPE 元数据应位于该指标样本之前。

Prometheus 3 对抓取响应的 `Content-Type` 要求更严格。端点应返回明确支持的媒体类型，而不是依赖缺失或错误 Content-Type 的历史容错。

## 3. 格式协商与 Native Histogram

Prometheus 会通过 HTTP `Accept` 协商文本、OpenMetrics 或 Protobuf 格式。文本格式便于人工检查；Protobuf 可表达 Native Histogram 等结构化样本。

Native Histogram 在 Prometheus 3.8 起成为稳定能力，但抓取仍需显式设置：

```yaml
scrape_configs:
  - job_name: api
    scrape_native_histograms: true
    static_configs:
      - targets: ["api:8080"]
```

是否启用要同时验证 Client Library、Remote Write 接收端、查询和长期存储的兼容性。它不是把经典 Histogram 自动变小的开关。

## 4. Scrape 的一次完整过程

以 30 秒间隔为例：

```text
调度下一次Scrape
→ 建立TCP/TLS连接
→ 发送带Accept的HTTP请求
→ 检查状态码、Content-Type和Body大小
→ 解析Metric Family和Label Set
→ 应用sample/label限制
→ 执行metric_relabel_configs
→ 为样本补充job、instance等Target Label
→ 追加到Head与WAL
→ 更新up、scrape_duration_seconds等自监控指标
```

`scrape_interval` 是调度间隔，`scrape_timeout` 必须小于间隔。每次抓取都接近 Timeout，会造成数据间断和持续压力，不能只把 Timeout 调得更长。

```yaml
global:
  scrape_interval: 30s
  scrape_timeout: 10s

scrape_configs:
  - job_name: api
    metrics_path: /metrics
    scheme: https
    static_configs:
      - targets: ["10.20.1.11:8443", "10.20.1.12:8443"]
        labels:
          env: prod
```

## 5. Prometheus 自动生成的抓取指标

| 指标 | 含义 |
| --- | --- |
| `up` | 最近一次抓取是否成功，成功为 1 |
| `scrape_duration_seconds` | 本次抓取消耗的时间 |
| `scrape_samples_scraped` | 目标暴露的样本数量 |
| `scrape_samples_post_metric_relabeling` | Metric Relabel 后保留的样本数 |
| `scrape_series_added` | 本次新增到 Head 的时序数 |

典型查询：

```promql
up{job="api"} == 0
scrape_duration_seconds{job="api"} / 10 > 0.8
scrape_samples_scraped{job="api"}
  - scrape_samples_post_metric_relabeling{job="api"}
```

`up=1` 只证明 Prometheus 成功读取并解析端点，不证明应用业务正常。

## 6. 服务发现不是健康检查

服务发现返回“候选目标及其元数据”。常见来源包括静态配置、文件、Kubernetes、Consul 和云厂商 API。发现目标后，Prometheus 把元数据作为以 `__meta_` 开头的临时 Label 交给 Target Relabel。

```text
Kubernetes API返回Pod/Service/EndpointSlice元数据
→ 形成Discovered Labels
→ relabel_configs筛选和改写
→ 生成最终Target Label
→ 加入Scrape Pool
```

发现到目标不等于网络可达，更不等于 `/metrics` 能返回正确格式。

## 7. Target Relabel 与 Metric Relabel

| 配置 | 操作对象 | 典型用途 |
| --- | --- | --- |
| `relabel_configs` | 抓取前的目标 | 保留目标、改地址、设置 job/instance |
| `metric_relabel_configs` | 抓取后的样本 | 丢弃高成本指标、删除危险 Label |

```yaml
relabel_configs:
  - source_labels: [__meta_kubernetes_namespace]
    regex: production
    action: keep
  - source_labels: [__meta_kubernetes_pod_label_app]
    target_label: app
  - source_labels: [__meta_kubernetes_pod_node_name]
    target_label: node

metric_relabel_configs:
  - source_labels: [__name__]
    regex: 'go_memstats_.*'
    action: drop
```

Relabel 按顺序执行。`drop/keep` 匹配的是 Label 拼接结果；错误 Regex 可能静默删除全部目标。先在 Prometheus UI 查看 Discovered Labels，再设计规则。

## 8. 抓取限制与基数保险丝

可配置样本数、目标数、Label 数、Label 名和值长度限制。限制用于阻止单个错误 Exporter 拖垮 Prometheus，但触发限制时整次抓取可能失败，必须监控相关指标和日志。

治理顺序是：在埋点处删除无界维度；缩小 Collector 范围；用 Metric Relabel 丢弃不需要的数据；最后使用限制作为安全边界。

## 9. Pushgateway 的正确边界

Prometheus 默认 Pull。短生命周期批任务可能在抓取前退出，可向 Pushgateway 推送任务级结果；它不适合把普通服务改成 Push，也不负责自动删除过期 Series。

Grouping Key 应描述稳定的批任务身份，不能放实例 ID 或每次执行 UUID。任务完成后按相同 Grouping Key 删除指标，否则会留下“幽灵成功/失败”。机器级批处理可优先使用 Node Exporter Textfile Collector。

## 10. 分层排障

```bash
curl -sv http://10.20.1.11:9100/metrics -o /tmp/metrics.txt
promtool check metrics </tmp/metrics.txt
```

| 现象 | 证据 | 下一层 |
| --- | --- | --- |
| Target 不存在 | Service Discovery/Discovered Labels | Selector、权限、Relabel |
| `connection refused` | Targets Last Error、curl | 进程、端口、Endpoint |
| Timeout | Duration、抓包、Exporter 日志 | 网络、采集查询、Body 规模 |
| TLS 错误 | SAN/CA/时间/握手日志 | CA、ServerName、证书轮换 |
| 401/403 | HTTP 状态与认证日志 | Token、RBAC、代理认证 |
| 格式错误 | Content-Type、promtool | Exporter 输出和协议协商 |
| `up=1` 但指标缺失 | Scraped/Post Relabel | Collector、Metric Relabel、查询 Label |

不要从浏览器所在电脑测试后直接认定 Prometheus Pod 也可达，应从实际抓取网络命名空间验证。

## 11. 实验与答案

**实验：** 暴露一个带 `user_id` Label 的 Counter，持续生成新用户，观察 Active Series；随后删除该 Label，并比较 Head Series、WAL 增长和查询耗时。

**问题：Service Discovery 已发现 Pod，为什么 Targets 仍可能没有它？**

答案：Target Relabel 可能将其删除，Prometheus CR 也可能未选择对应 Monitor 对象；发现只是候选输入。

**问题：为什么不能用 Metric Relabel 修复所有高基数问题？**

答案：样本已经被目标生成、传输并解析，仍消耗 Exporter 和抓取资源；且规则容易漏掉其他采集端。最优修复点是指标源头。

## 12. 参考资料

- [Prometheus Instrumentation](https://prometheus.io/docs/practices/instrumentation/)
- [Exposition Formats](https://prometheus.io/docs/instrumenting/exposition_formats/)
- [Prometheus Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Native Histograms](https://prometheus.io/docs/specs/native_histograms/)
