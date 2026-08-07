---
title: "Error Budget 与多窗口燃烧率告警"
sidebar_position: 10
tags: [Kubernetes, SRE, Error Budget, Burn Rate, Prometheus, PromQL]
description: "从 SLO 推导错误预算和燃烧率，使用 Prometheus recording rules 与多窗口多燃烧率告警发现真正威胁用户体验的问题。"
---

# Error Budget 与多窗口燃烧率告警

固定阈值告警常见两个极端：

- `5xx > 0`：低峰期一个错误就报警，噪音很大。
- `5xx > 5% for 10m`：持续的小比例错误足以耗尽月度目标，却一直不报警。

Error Budget 告警不直接问“现在有多少错误”，而是问：

> 按当前速度继续下去，服务会多快耗尽 SLO 允许的全部错误？

---

## 1. 从 SLO 推导 Error Budget

假设可用性 SLO 为 99.9%：

```text
SLO target             = 0.999
allowed error ratio    = 1 - 0.999 = 0.001
```

如果 30 天内有 10,000,000 个有效请求：

```text
error budget = 10,000,000 × 0.001 = 10,000 个 bad events
```

错误预算是允许失败的上限，不是期望失败这么多。

### 事件型预算

```text
remaining_budget =
  valid_events × allowed_error_ratio - bad_events
```

### 时间型直觉

30 天窗口的 99.9% SLO，大约允许 43.2 分钟不可用。但请求型 SLO 必须按事件计算，
不能把流量高峰 1 分钟和凌晨 1 分钟视为同样影响。

---

## 2. Burn Rate 的定义

```text
burn_rate = observed_error_ratio / allowed_error_ratio
```

对于 99.9% SLO，允许错误率是 0.1%：

| 实际错误率 | Burn Rate | 含义 |
| --- | --- | --- |
| 0.05% | 0.5 | 预算消耗速度低于允许值 |
| 0.1% | 1 | 按这个速度恰好在窗口末耗尽 |
| 0.6% | 6 | 以允许速度的 6 倍消耗 |
| 1.44% | 14.4 | 以允许速度的 14.4 倍消耗 |
| 10% | 100 | 严重故障 |

Burn Rate 与目标值解耦。99%、99.9% 和 99.99% 的服务都可以使用同一套“预算消耗
速度”语言。

---

## 3. 为什么需要多个观察窗口

单个短窗口敏感但容易抖动；单个长窗口稳定但发现故障太慢。

多窗口告警要求同一个问题同时满足：

```text
长窗口 Burn Rate 超阈值
AND
短窗口 Burn Rate 超阈值
```

- 长窗口确认问题对预算有实质影响。
- 短窗口确认问题现在仍然存在。

一组常用的 30 天 SLO 参数：

| 级别 | 长窗口 | 短窗口 | Burn Rate | 大致预算消耗 |
| --- | --- | --- | --- | --- |
| Page | 1h | 5m | 14.4 | 1 小时消耗约 2% 月预算 |
| Page | 6h | 30m | 6 | 6 小时消耗约 5% 月预算 |
| Ticket | 3d | 6h | 1 | 3 天消耗约 10% 月预算 |

这些值不是必须照抄。推导公式为：

```text
burn_rate =
  budget_fraction_to_consume
  × slo_window
  / alert_long_window
```

例如想在 1 小时消耗 2% 的 30 天预算时报警：

```text
burn_rate = 0.02 × 720h / 1h = 14.4
```

---

## 4. 先建立 Recording Rules

直接在每条 Alert 中重复复杂查询，既难读又浪费计算。

假设网关计数器：

```text
llm_gateway_requests_total{
  service,
  region,
  model_family,
  slo_eligible,
  result_reason
}
```

### 4.1 记录有效事件速率

```yaml
groups:
  - name: llm-slo-recording
    interval: 30s
    rules:
      - record: service:slo_valid_requests:rate5m
        expr: |
          sum by (service, region, model_family) (
            rate(llm_gateway_requests_total{
              slo_eligible="true"
            }[5m])
          )

      - record: service:slo_bad_requests:rate5m
        expr: |
          sum by (service, region, model_family) (
            rate(llm_gateway_requests_total{
              slo_eligible="true",
              result_reason!="success"
            }[5m])
          )
```

### 4.2 为每个告警窗口记录错误率

```yaml
      - record: service:slo_error_ratio:rate5m
        expr: |
          (
            sum by (service, region, model_family) (
              rate(llm_gateway_requests_total{
                slo_eligible="true",
                result_reason!="success"
              }[5m])
            )
          )
          /
          (
            sum by (service, region, model_family) (
              rate(llm_gateway_requests_total{
                slo_eligible="true"
              }[5m])
            )
          )

      - record: service:slo_error_ratio:rate1h
        expr: |
          (
            sum by (service, region, model_family) (
              rate(llm_gateway_requests_total{
                slo_eligible="true",
                result_reason!="success"
              }[1h])
            )
          )
          /
          (
            sum by (service, region, model_family) (
              rate(llm_gateway_requests_total{
                slo_eligible="true"
              }[1h])
            )
          )
```

实际配置还要生成 `30m`、`6h`、`3d` 等窗口。

---

## 5. 99.9% 可用性多窗口告警

允许错误率：

```text
1 - 0.999 = 0.001
```

14.4 倍和 6 倍阈值对应：

```text
14.4 × 0.001 = 0.0144
6 × 0.001    = 0.006
```

Prometheus Rule：

```yaml
groups:
  - name: llm-slo-alerts
    rules:
      - alert: LLMAvailabilityBudgetFastBurn
        expr: |
          (
            service:slo_error_ratio:rate1h > 14.4 * 0.001
            and
            service:slo_error_ratio:rate5m > 14.4 * 0.001
          )
          or
          (
            service:slo_error_ratio:rate6h > 6 * 0.001
            and
            service:slo_error_ratio:rate30m > 6 * 0.001
          )
        for: 2m
        labels:
          severity: page
          slo: availability
        annotations:
          summary: "LLM 服务正在快速消耗可用性错误预算"
          description: >-
            {{ $labels.service }} / {{ $labels.region }} /
            {{ $labels.model_family }} 的错误预算燃烧率超过阈值。
          runbook_url: "https://example.com/runbooks/llm-availability"

      - alert: LLMAvailabilityBudgetSlowBurn
        expr: |
          service:slo_error_ratio:rate3d > 1 * 0.001
          and
          service:slo_error_ratio:rate6h > 1 * 0.001
        for: 30m
        labels:
          severity: ticket
          slo: availability
        annotations:
          summary: "LLM 服务正在持续消耗可用性错误预算"
```

`for` 用于过滤评估抖动，不应该把本应快速发现的故障再延迟几十分钟。

---

## 6. TTFT SLO 如何计算 Burn Rate

假设：

```text
99% 请求 TTFT <= 2s
allowed slow ratio = 1 - 0.99 = 0.01
```

慢请求比例：

```promql
1 -
(
  sum(rate(llm_request_ttft_seconds_bucket{
    slo_eligible="true",
    le="2"
  }[5m]))
  /
  sum(rate(llm_request_ttft_seconds_count{
    slo_eligible="true"
  }[5m]))
)
```

Burn Rate：

```promql
(
  1 -
  (
    sum(rate(llm_request_ttft_seconds_bucket{
      slo_eligible="true",
      le="2"
    }[5m]))
    /
    sum(rate(llm_request_ttft_seconds_count{
      slo_eligible="true"
    }[5m]))
  )
)
/
0.01
```

记录规则最好直接存 `slow_ratio`，Alert 再与 `14.4 * 0.01` 比较，避免表达式过长。

### 为什么不能用 P99 做错误预算

`histogram_quantile()` 可以显示延迟分位数，但 P99 超过 2 秒时，无法直接知道有多少
事件消耗了预算。使用 `le="2"` 的 Bucket 可以直接计算阈值内/阈值外事件比例。

因此定义延迟 SLO 时，应提前让 Histogram 包含 SLO 边界 Bucket，例如：

```text
0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30
```

---

## 7. 低流量服务的处理

低流量下一个错误可能产生极高错误率。

不能简单把低流量全部排除，因为关键但低频的模型仍然可能故障。

推荐分层处理：

### 7.1 Page 增加最小事件条件

```promql
(
  service:slo_error_ratio:rate5m > 14.4 * 0.001
)
and
(
  sum by (service, region, model_family) (
    increase(llm_gateway_requests_total{
      slo_eligible="true"
    }[5m])
  ) >= 100
)
```

### 7.2 低流量使用合成探测

真实流量不足时，从外部定时发送合成请求，测量：

- DNS 和 TLS。
- Gateway 鉴权与路由。
- 模型请求成功。
- 首 token 和流式完成。

合成流量和真实用户 SLI 应分开存储，最后在告警策略中互相补充。

### 7.3 关键模型单独建 SLO

不要让低流量关键模型被平台总流量淹没。

---

## 8. 无数据不是成功

下面的错误写法会在没有流量时得到空结果：

```promql
bad / valid
```

空结果可能代表：

- 服务确实没有请求。
- Prometheus 抓取失败。
- 指标名称变更。
- Gateway 故障，计数器不再增长。
- Recording Rule 执行失败。

因此需要独立监控：

```promql
up{job="llm-gateway"} == 0
```

```promql
time() - timestamp(llm_gateway_requests_total) > 300
```

并为 SLO 数据链路定义完整性告警：

```yaml
- alert: LLMSLOMetricsMissing
  expr: absent(up{job="llm-gateway"} == 1)
  for: 5m
  labels:
    severity: page
  annotations:
    summary: "LLM SLO 指标采集链路中断"
```

不要使用 `or vector(0)` 把所有无数据都伪装成零错误。

---

## 9. 维护窗口与发布流量

计划内维护不应靠删除历史数据实现。

正确做法：

1. 在维护前通过负载均衡摘除实例。
2. 等待已有流式请求完成或到达 drain deadline。
3. 保证用户流量被其他实例承接。
4. 如果服务整体仍有请求失败，这些失败仍应消耗预算。

Canary 应保留 `release_channel="canary"` 等稳定维度：

- Canary SLO 用于发布门禁。
- Stable SLO 用于用户承诺。
- 平台总 SLO 反映真实总体体验。

---

## 10. Alertmanager 路由原则

错误预算告警应按处置动作分级：

| 告警 | 通知 | 动作 |
| --- | --- | --- |
| Fast burn | Page / 电话 | 立即止损、回滚、降级、扩容或切流 |
| Slow burn | 工单 / 工作群 | 工作时间分析长期退化 |
| Budget exhausted | 发布门禁 | 暂停高风险发布，优先恢复可靠性 |
| Metrics missing | Page 或平台告警 | 修复观测链路，避免盲飞 |

告警 Annotation 至少包含：

- 受影响服务、区域、模型。
- SLO 名称。
- 长短窗口当前值。
- 看板链接。
- Runbook 链接。
- 最近发布或变更查询入口。

---

## 11. 规则验证

### 11.1 语法检查

```bash
promtool check rules llm-slo-recording.yaml
promtool check rules llm-slo-alerts.yaml
```

### 11.2 单元测试

`promtool test rules` 可以给定输入时序并验证告警是否触发：

```yaml
rule_files:
  - llm-slo-recording.yaml
  - llm-slo-alerts.yaml

evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'llm_gateway_requests_total{slo_eligible="true",result_reason="success",service="chat",region="cn-east-1",model_family="llama"}'
        values: '0+985x120'
      - series: 'llm_gateway_requests_total{slo_eligible="true",result_reason="backend_timeout",service="chat",region="cn-east-1",model_family="llama"}'
        values: '0+15x120'

    alert_rule_test:
      - eval_time: 65m
        alertname: LLMAvailabilityBudgetFastBurn
        exp_alerts:
          - exp_labels:
              alertname: LLMAvailabilityBudgetFastBurn
              service: chat
              region: cn-east-1
              model_family: llama
              severity: page
              slo: availability
```

测试数据的写法和具体预期需按 Prometheus 版本验证；重点是把以下场景加入 CI：

- 正常流量不触发。
- 短暂尖峰不触发长窗口条件。
- 持续高错误同时满足长短窗口。
- 指标中断触发 missing 告警。
- 低流量按预期走合成探测或低流量策略。

---

## 12. 看板应该展示什么

一个错误预算看板至少包含：

1. 当前 30 天 SLI 与目标线。
2. 已消耗和剩余预算百分比。
3. 5m、30m、1h、6h、3d Burn Rate。
4. bad events 按 `result_reason` 分解。
5. 按区域、模型、发布槽位分解。
6. 发布、扩缩容、节点故障等事件标记。

错误预算面板负责判断“影响有多严重”；GPU、网络和存储面板负责回答“为什么”。

---

## 13. 常见错误

### 错误 1：只监控平均延迟

平均值会掩盖尾延迟，且不能直接计算阈值达标率。

### 错误 2：所有 4xx 都排除

平台容量不足返回的 429、网关错误产生的 400 仍可能是服务责任。

### 错误 3：只用一个 5 分钟窗口

短窗口对尖峰敏感，会造成告警噪音。

### 错误 4：只看月度预算

月度结果可能在故障持续数小时后才明显下降，失去快速响应价值。

### 错误 5：无数据按 100% 可用处理

观测链路中断时会把系统故障伪装为健康。

### 错误 6：规则没有测试

Label 对不齐、分母为空、窗口写错，都可能让告警永远不触发。

---

## 14. 实验任务

1. 部署一个测试网关并暴露 valid/good event Counter。
2. 为 99.9% 可用性建立 5m、30m、1h、6h Recording Rules。
3. 注入 2% 后端错误，观察 14.4 倍 Fast Burn 告警。
4. 停止指标采集，确认触发 Metrics Missing，而不是显示 100% 可用。
5. 注入 TTFT 延迟，验证延迟 SLO 使用 Bucket 达标率。
6. 用 `promtool check rules` 和 `promtool test rules` 加入 CI。

## 15. 参考资料

- [Google SRE Workbook：Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
- [Google SRE Workbook：Error Budget Policy](https://sre.google/workbook/error-budget-policy/)
- [Prometheus Recording Rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/)
- [Prometheus Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus Alerting Best Practices](https://prometheus.io/docs/practices/alerting/)

下一篇将从告警触发开始，建立 AI 平台事件的技术响应流程、跨层证据包和 RCA
因果分析方法。
