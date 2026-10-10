---
title: "Grafana Data Source、Dashboard、Variable、Annotation 与告警联动"
sidebar_label: "08. Grafana 看板与告警联动"
sidebar_position: 8
description: "建立可验证的 Grafana 查询和看板设计方法，覆盖数据源、变量、面板语义、注释、Exemplar、告警跳转、Provisioning 与查询治理。"
tags: [Grafana, Dashboard, Variable, Annotation, Prometheus]
---

# Grafana Data Source、Dashboard、Variable、Annotation 与告警联动

Grafana 是查询和呈现层，不会修复错误指标。一个生产看板必须能够回答：用户是否受影响、影响在哪个维度、从什么时候开始、变化前发生了什么、下一步应去哪里取证。

## 1. 查询链路

```text
浏览器选择时间范围和变量
→ Grafana Backend展开变量与宏
→ Prometheus Data Source API
→ PromQL Range/Instant Query
→ Data Frame转换
→ Panel计算、单位和阈值
→ 浏览器渲染
```

面板错误可能来自 PromQL，也可能来自变量展开、Data Source、Transform、单位、Reduce 或浏览器。调试时先在 Explore 执行展开后的查询，再检查 Panel 变换。

## 2. Data Source 基线

Prometheus、Thanos Query 和 Mimir 都可提供兼容查询 API，但 HA 去重、租户 Header、查询前端和数据新鲜度不同。

配置至少包括：

- 由 Grafana Server 可达的 URL，而不是用户浏览器可达的地址；
- TLS CA、Server Name 和认证方式；
- 查询超时、默认 Scrape Interval 和 HTTP 行为；
- 组织/Folder/Data Source 权限；
- Tenant Header 或云端认证；
- Exemplar 到 Trace Data Source 的关联。

生产凭据通过 Secret 和 Provisioning 注入，不写入 Dashboard JSON。

## 3. 从 SLO 到资源证据的看板结构

```text
Row 1 用户结果：请求率、错误率、P95/P99、SLO Burn Rate
Row 2 服务机制：队列、并发、重试、缓存、依赖耗时
Row 3 资源证据：CPU、内存、网络、磁盘、Pod/节点
Row 4 关联证据：发布Annotation、日志、Trace、Profile
```

第一屏先回答影响，不要从 CPU 利用率开始。资源正常不代表用户请求正常，反之高 CPU 也不一定是故障。

## 4. Panel 查询的时间语义

Grafana 常用宏：

```promql
sum by (service) (
  rate(http_requests_total{cluster="$cluster"}[$__rate_interval])
)
```

`$__rate_interval` 根据 Scrape Interval 和 Panel Step 选择适合 `rate` 的窗口，通常比机械写 `[1m]` 更稳健。仍需确保 Data Source 的 Scrape Interval 配置与实际一致。

Max Data Points 和 Min Interval 会影响 Range Query 的 Step。降低 Step 不是“更精确”的免费操作，它会增加返回点数和 Prometheus 求值次数。

## 5. 单位、阈值与缺数据

- 0.95 是比例还是 95%，要选择正确单位；
- Byte 与 Bit、秒与毫秒必须明确；
- 自动 Y 轴可能把微小波动画成巨大变化；
- Stat 的 Last、Last Not Null、Max 和 Reduce 含义不同；
- No Data、0、NaN 和查询错误必须使用不同视觉状态；
- 不要用 `or vector(0)` 隐藏 Target Down。

阈值颜色用于表达业务含义，不应每个面板都用绿色到红色的装饰性渐变。

## 6. 变量的查询和基数

常见层级：

```text
data_source → cluster → namespace → service → instance
```

Prometheus 变量查询应使用已选择的上级约束，避免全局枚举所有 Pod：

```text
label_values(kube_service_info{cluster="$cluster",namespace="$namespace"}, service)
```

多选变量在 PromQL 中通常使用正则匹配：

```promql
metric{service=~"${service:regex}"}
```

使用 `service="$service"` 可能在多选时失效。`All` 若展开成所有值会生成超长查询，优先设置受控正则并限制允许范围。变量默认值不能固定选择一个健康实例，否则总览会隐藏其他实例。

## 7. Annotation

Annotation 把发布、扩缩容、配置变更、故障演练和告警状态叠加到曲线上，用来回答“指标变化之前发生了什么”。

Prometheus Annotation 查询会把返回的每个数据点转换为事件，并不会自动忽略零值。持续返回数据的普通指标会淹没看板，应选择事件型表达式：

```promql
changes(process_start_time_seconds{job="$job"}[5m]) > 0
ALERTS{alertstate="firing",service=~"$service"}
```

还可从发布系统通过 Grafana API 写入准确事件。必须统一时区和时间同步，否则“发布先于故障还是晚于故障”会被误判。

## 8. Exemplar 与日志、Trace 跳转

Histogram Bucket 可携带带 Trace ID 的 Exemplar。Grafana 从延迟曲线上的代表样本跳转到 Tempo/Jaeger，再从 Span 跳日志：

```text
P99异常点
→ Exemplar Trace ID
→ Trace关键路径
→ 具体Span的服务/实例
→ 同Request ID日志
```

Exemplar 是样本，不代表所有慢请求。跳转失败时依次检查采集格式、Prometheus Exemplar 存储、Data Source 映射、Trace ID 字段和 Trace 保留期。

## 9. 告警与看板联动

告警 Annotation 中的 Dashboard/Panel URL 应携带关键变量和故障时间范围：

```text
/d/api-overview?var-cluster=prod-a&var-service=order
&from=now-30m&to=now
```

固定 `now` 链接在事后打开会失去故障时段。更成熟的通知系统根据告警开始时间生成绝对时间范围或可回看的链接。

看板不等于告警：Panel Transform、客户端计算或视觉阈值不一定能在告警引擎中复用。告警表达式应在规则系统中独立测试。

## 10. Dashboard as Code

生产看板通过 Provisioning、Jsonnet/Grafonnet、Terraform 或 Operator 等方式管理：

```text
源文件
→ 格式/Schema检查
→ 测试Data Source与PromQL
→ 代码评审
→ 生成Dashboard JSON
→ Provisioning/发布
→ 截图与查询回归
```

手工 UI 修改可能在下一次 Provisioning 时被覆盖。需要明确谁是事实来源、UID 是否稳定、Folder 和权限如何管理，以及跨环境变量怎样注入。

## 11. 查询风暴与治理

一个 Dashboard 的成本约等于：

```text
用户数 × 面板数 × 每面板查询数 × 刷新频率 × 查询范围内Series/Points
```

常见优化：

- 总览使用 Recording Rule；
- 合并可共享的查询；
- 限制默认时间范围与最小刷新间隔；
- 避免无界变量和大正则；
- 下钻看板才查询 Pod/Instance；
- 对查询前端配置缓存、并发和公平性；
- 监控 Grafana 自身、Data Source 错误和慢查询。

## 12. 验收与答案

模拟 API 延迟告警，要求值班人员三次点击内定位到服务、异常实例和 Trace/日志；删除 Target，验证看板能区分无流量和无数据；回放一次发布，确认 Annotation 时间正确。

**问题：同一个 PromQL 在 Explore 有数据，Panel 却显示 No Data，查什么？**

答案：检查变量展开、时间范围、Query 类型、Transform、Reduce、Data Source UID 和 Panel 的重复/过滤设置。

**问题：为什么不应把自动刷新设为 1 秒？**

答案：指标通常以 15～60 秒抓取，1 秒刷新不会产生更多原始信息，却会将 Range Query 压力放大数十倍。

## 13. 参考资料

- [Grafana Prometheus Data Source](https://grafana.com/docs/grafana/latest/datasources/prometheus/)
- [Grafana Variables](https://grafana.com/docs/grafana/latest/dashboards/variables/)
- [Grafana Prometheus Annotations](https://grafana.com/docs/grafana/latest/datasources/prometheus/annotations/)
- [Grafana Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
