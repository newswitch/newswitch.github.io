---
title: "Metrics、Logs、Traces、Exemplar 与 Profile 关联分析"
sidebar_label: "14. 多信号关联分析"
sidebar_position: 14
description: "用统一 Resource、Trace ID、Exemplar、Span Metrics 和 Profile 建立从告警到单次请求再到底层热点的证据链。"
tags: [Metrics, Logs, Traces, Exemplars, Profiles]
---

# Metrics、Logs、Traces、Exemplar 与 Profile 关联分析

多信号关联不是把四套页面放进同一 Grafana，而是让它们共享稳定身份、时间语义和可跳转键，并清楚每种信号能回答什么。

## 1. 四种信号的职责

| 信号 | 擅长回答 | 不擅长回答 |
| --- | --- | --- |
| Metrics | 影响范围、趋势、SLO、容量 | 单次请求完整细节 |
| Logs | 离散事件、错误文本、审计上下文 | 低成本全局统计和因果结构 |
| Traces | 单次请求路径、阶段耗时、依赖关系 | 无偏总体统计、代码行 CPU 热点 |
| Profiles | CPU、内存等资源消耗落在哪个调用栈 | 某个请求完整网络因果链 |

正确路径通常是先用 Metrics 发现，再用 Trace 缩小关键路径，用 Logs 读取上下文，最后用 Profile 解释节点或函数热点。

## 2. 统一身份：Resource

至少统一这些 Resource 属性：

```text
service.name
service.namespace
service.version
deployment.environment.name
k8s.cluster.name
k8s.namespace.name
k8s.pod.name
cloud.region / cloud.availability_zone
```

字段应由可信环境或 Collector 补充，不能让每个团队随意命名。若指标使用 `app=order`、日志使用 `service=order-api`、Trace 使用默认 `unknown_service`，页面再漂亮也无法可靠关联。

稳定 Resource 用于聚合；Pod UID、Trace ID 等高基数身份只用于明细和跳转，不进入常规指标 Label。

## 3. Metrics → Trace：Exemplar

Exemplar 在某个指标样本上附带 Trace ID 等引用：

```text
http_server_duration_seconds_bucket
  {service="order-api",le="2.5"} 1250
  exemplar: trace_id=4bf92f...
```

Grafana 可从 P99 或某个 Histogram 桶跳到代表性 Trace。前提是：

- 指标是 Histogram，SDK/Collector 支持 Exemplar；
- 记录样本时当前请求 Context 中有有效 Trace；
- Prometheus/Mimir 保留 Exemplar；
- 数据源配置知道怎样拼接 Tempo/Jaeger 查询。

Exemplar 只是该时间序列上的样例，不是所有慢请求。没有 Exemplar 也不证明没有 Trace，可能是采样、Reservoir 或存储配置所致。

## 4. Trace → Logs

应用日志自动注入 `trace_id` 和 `span_id`，Grafana 派生字段或数据源关联据此跳转：

```text
Trace Span
→ service.name + trace_id + 时间窗口
→ Loki 查询相同 Trace 的日志
```

查询时不要只用 Trace ID 做无界全文搜索。先用服务/命名空间 Label 和 Span 时间缩小范围，再解析正文：

```logql
{cluster="prod", namespace="orders", service="order-api"}
  | json
  | trace_id="4bf92f3577b34da6a3ce929d0e0e4736"
```

若日志时间与 Span 相差很大，检查时钟、异步缓冲和采集延迟。

## 5. Logs → Trace

反向跳转要求日志中的 Trace ID 格式稳定。不要用正则从任意文本猜测所有 32 位十六进制字符串；优先使用结构化字段。

一条 Error 日志跳到 Trace 后，应确认：日志所在 Span 是否被采样、后端是否收到整条 Trace、错误是否是最终失败。日志写了 ERROR 但 Trace 最终成功，可能只是内部重试。

## 6. Trace → Metrics：Span Metrics 与 Service Graph

Span Metrics 把 Span 转换为调用次数、错误与延迟；Service Graph 匹配调用两端生成边。它们能从 Trace 语义构建服务 RED 视图。

关键边界：

- 在 Tail Sampling 前生成，才能尽量反映全部 Span；
- 避免将 URL 实值、用户 ID、Trace ID 加入指标维度；
- 明确重试是一次用户请求还是多次下游调用；
- 指标与应用原生指标口径不同，应解释差值而非强行对齐；
- Collector 与 Tempo 不要重复生成同一套指标。

## 7. Profile 如何加入证据链

连续剖析系统通常按服务、版本、Pod 等 Label 存储 Profile。关联方式有两类：

```text
时间窗口关联：
慢 Trace 的 [开始, 结束]
→ 同服务/Pod 同时间窗口的 CPU Profile

Span/Profile 关联：
运行时或剖析系统直接将 Span 上下文关联到样本
→ 在 Span 中查看该请求期间的调用栈
```

时间窗口关联只是相关性：同一 Pod 同时处理许多请求，热点不一定属于目标 Trace。Span 级 Profile 更精确，但需要运行时与工具支持，并带来额外数据成本。

## 8. 一次 P99 告警的完整分析

```text
1. Metrics：确认 P99 上升范围，是单服务、单版本还是单 AZ
2. Exemplar：打开慢请求 Trace
3. Trace：发现 2.3s 位于 payment CLIENT span，且有两次重试
4. Logs：以 service + trace_id 查询，得到上游 429 和重试退避
5. Metrics：检查 payment 的限流率、连接池和各 AZ 差异
6. Profile：若 CLIENT span 内存在明显本地空白，再看进程 CPU/锁热点
```

这条链路避免“看到 CPU 高就扩容”或“看到网络 Span 慢就甩给网络”。每一步都缩小假设。

## 9. 时间、采样与缺失证据

不同信号保留期可能不同：Metrics 90 天、日志 14 天、Trace 3 天、Profile 7 天。调查旧事故时不能假设所有跳转仍有效。

采样也会造成断点：

- Head Sampling 可能没有目标 Trace；
- Tail Sampling 偏向错误与长尾；
- 日志采样可能没有成功请求日志；
- Profile 是统计样本，不包含每次函数执行。

因此“没找到”只表示当前证据链未保留，不能直接证明事件未发生。

## 10. 安全与基数

用于关联的 ID 仍属于不可信输入，必须验证格式和长度。Trace/Baggage 中不要传播敏感数据；跳转 URL 也不应把 Token 或用户隐私直接暴露在浏览器历史。

关联配置要遵守：

- 指标 Label 只保留可控维度；
- Loki 中 Trace ID 留正文/结构化元数据，不做索引 Label；
- Trace 属性限制长度与数量；
- Profile Label 不包含线程 ID、请求 ID 等无限基数；
- 每个后端实施一致的租户授权。

## 11. 验收

构造一条可控的慢请求并保存 Trace ID，完成以下闭环：

```text
指标面板找到时间窗口
→ Exemplar 打开 Trace
→ Trace 打开同一请求日志
→ 日志反向返回 Trace
→ Span Metrics 找到服务边
→ 同服务/版本/Pod 打开 Profile
```

再验证采样未命中、日志过期、跨租户和 Trace 后端不可用时，页面给出明确失败而不是错误跳转。

## 12. 练习与答案

**问题：GPU Util 下降且推理 P99 上升，应该先看哪种信号？**

答案：先用 Metrics 判断范围并同时看请求率、排队、TTFT/TPOT、CPU、网络和存储；再通过 Trace 分解网关、调度、队列、模型执行阶段，日志读取限流/错误上下文。GPU 低利用率可能是没有请求，也可能是上游排队或数据供应不足。

**问题：一条慢 Trace 的 CPU Profile 很热，能否证明该请求消耗了这些 CPU？**

答案：若只是相同时间窗口和 Pod，只能说明相关，不能证明归因。需要 Span-aware Profiling 或更精确实验验证。

参考资料：

- [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/)
- [Prometheus exemplars](https://prometheus.io/docs/specs/om/open_metrics_spec/#exemplars)
- [Tempo metrics-generator](https://grafana.com/docs/tempo/latest/metrics-generator/)
