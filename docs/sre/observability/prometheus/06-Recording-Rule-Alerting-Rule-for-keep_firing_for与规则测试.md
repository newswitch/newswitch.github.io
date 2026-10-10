---
title: "Recording Rule、Alerting Rule、for、keepfiringfor 与规则测试"
sidebar_label: "06. 规则、状态机与测试"
sidebar_position: 6
description: "理解规则组调度、Recording Rule 预计算、告警实例状态机、标签合并、缺数据语义和 promtool 单元测试。"
tags: [Prometheus, Recording Rule, Alerting Rule, promtool, 告警]
---

# Recording Rule、Alerting Rule、for、keepfiringfor 与规则测试

规则不是定时执行一段 YAML。Prometheus 在每个 Rule Group 的评估时刻执行 PromQL，Recording Rule 把结果写回 TSDB，Alerting Rule 则为每个结果 Label Set 维护独立状态机。

```text
Rule Group到达评估时间
→ 组内规则按顺序、使用同一评估时间执行
→ Recording结果写为新Series
→ 后续规则可以读取前面的结果
→ Alert表达式的每个Label Set更新状态
→ Firing告警持续发送给Alertmanager
```

## 1. Rule Group 的调度语义

```yaml
groups:
  - name: api-sli
    interval: 30s
    query_offset: 1m
    rules: []
```

Group 内规则顺序执行，跨 Group 没有执行顺序保证。Group 的执行耗时超过 Interval 会造成评估延迟或错过调度；不要把几十个重查询全塞入一个 Group。

`query_offset` 让整个组查询更早的评估时间，适合等待远程或迟到数据，但会让规则结果整体后移。使用前必须明确数据到达延迟和告警时效，不能作为慢查询补丁；旧版本是否支持该字段要以实际版本文档和 `promtool` 校验结果为准。

## 2. Recording Rule 的价值与代价

```yaml
- record: cluster_service:http_requests:rate5m
  expr: |
    sum by (cluster, service) (
      rate(http_requests_total[5m])
    )
```

它适合：多个看板和告警反复执行的昂贵查询；需要固定聚合维度的 SLI；长期存储前进行稳定降维。

代价包括新 Series、评估延迟和重复数据。不要为每个临时面板建立 Recording Rule，也不要把 Pod UID、请求 ID 等高基数 Label 保留到结果。

命名常用 `level:metric:operations` 风格，但一致的组织规范比机械套模板更重要。需要记录来源表达式、Owner 和兼容变更方式。

## 3. 错误率规则的正确拆分

```yaml
- record: cluster_service:http_requests:rate5m
  expr: sum by (cluster, service) (rate(http_requests_total[5m]))

- record: cluster_service:http_errors:rate5m
  expr: sum by (cluster, service) (rate(http_requests_total{code=~"5.."}[5m]))

- record: cluster_service:http_error_ratio:rate5m
  expr: |
    cluster_service:http_errors:rate5m
    /
    cluster_service:http_requests:rate5m
```

分子与分母必须保留相同 Label，并处理分母为零。低流量时一个错误就可能得到 100%，告警还需设置最小请求率条件。

## 4. Alerting Rule 是一组告警实例

```yaml
- alert: ApiErrorRateHigh
  expr: |
    cluster_service:http_error_ratio:rate5m > 0.05
    and on (cluster, service)
    cluster_service:http_requests:rate5m > 1
  for: 10m
  keep_firing_for: 5m
  labels:
    severity: page
    team: platform
  annotations:
    summary: "{{ $labels.service }} 错误率持续升高"
    value: "{{ printf \"%.3f\" $value }}"
    runbook_url: "https://runbooks.example.com/api-error-rate"
```

表达式返回两条不同 `service` Series，就形成两个独立告警实例。实例身份由最终 Label Set 决定；易变 Label 会让旧告警 Resolved、新告警重新 Pending。

## 5. Pending、Firing 与恢复

```text
Inactive
  └─ 条件首次为真 → Pending
Pending
  ├─ 连续满足for → Firing
  └─ 条件为假/Series消失 → Inactive
Firing
  ├─ 条件持续为真 → Firing
  └─ 条件消失 → keep_firing_for窗口 → Inactive
```

`for` 过滤短抖动；它不会要求窗口内每一个原始样本都超阈值，而是要求每次规则评估结果持续为真。Prometheus 重启、规则 Label 改变或长时间缺数据会影响状态连续性。

`keep_firing_for` 用于短暂缺样本或阈值附近抖动，但会延迟真实恢复通知。它不是修复不可靠采集的办法。

## 6. 标签优先级和模板

告警结果先继承表达式 Series Label，再叠加规则 `labels`，同名规则 Label 会覆盖原值。外部 Label 通常在发送到外部系统时用于标识集群。

Annotations 不参与告警身份，适合 Summary、Description、Dashboard 和 Runbook。模板只能使用已保留的 Label；不要在模板里执行复杂业务判断，也不要把 Secret 或完整请求参数写入通知。

## 7. 缺数据必须单独建模

阈值告警与缺数据告警是不同故障：

```yaml
- alert: ApiMetricsAbsent
  expr: absent_over_time(http_requests_total{service="order"}[10m])
  for: 5m
  labels:
    severity: ticket
```

需要结合 `up` 判断到底是服务无流量、指标改名、Target Down 还是 Relabel 删除。盲目 `or vector(0)` 会让采集故障显示为健康。

## 8. SLO 多窗口燃烧率

单一 5 分钟错误率容易对短尖峰过敏，也可能对缓慢消耗 Error Budget 反应太迟。多窗口告警用短窗口确认当前仍在燃烧，用长窗口确认消耗具有持续性：

```text
Page：高Burn Rate，短窗口 + 长窗口同时超过阈值
Ticket：较低Burn Rate，更长窗口持续超过阈值
```

具体阈值由 SLO、告警时间目标和 Error Budget 推导，不应复制固定数字后宣称适合所有业务。

## 9. promtool 检查与单元测试

```bash
promtool check rules rules.yml
promtool test rules rules.test.yml
```

最小测试：

```yaml
rule_files:
  - rules.yml

evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'http_requests_total{cluster="prod",service="order",code="200"}'
        values: '0+60x20'
      - series: 'http_requests_total{cluster="prod",service="order",code="500"}'
        values: '0+6x20'
    alert_rule_test:
      - eval_time: 15m
        alertname: ApiErrorRateHigh
        exp_alerts:
          - exp_labels:
              alertname: ApiErrorRateHigh
              cluster: prod
              service: order
              severity: page
              team: platform
```

实际测试还要覆盖：阈值下方、恰好等于阈值、Counter Reset、低流量、缺样本、Label 变化、进入 Pending、达到 Firing 和恢复。

## 10. 规则运行的自监控

关注 Rule Evaluation Duration、Missed Iterations、Evaluation Failures、Last Evaluation 和产生 Series 数。具体指标以当前版本 `/metrics` 为准。

典型问题：

| 现象 | 原因 |
| --- | --- |
| 规则间歇空洞 | 数据迟到、查询失败、Group 超时 |
| CPU 突增 | 大范围正则、Join、Subquery、Group 同时执行 |
| 告警生成但无人收到 | Alertmanager 发现/网络/路由问题 |
| 告警反复 Pending | Label Set 变化或条件短暂为假 |
| Rule Series 爆炸 | 输出保留高基数维度 |

## 11. 发布和回滚

```text
代码评审
→ promtool check
→ promtool test rules
→ 预发布回放或影子查询
→ 灰度加载
→ 验证Rules页面、Pending/Firing/Resolved
→ 验证Alertmanager路由与通知量
→ 全量发布
```

重命名 Recording Rule 会让旧 Series 与新 Series 在 Retention 周期内共存。删除或修改告警 Label 也会改变实例身份，发布说明必须包含兼容影响。

## 12. 练习与答案

**问题：表达式连续 10 分钟为真，`for: 10m` 就一定 Firing 吗？**

答案：还要求规则组持续正常评估且该告警实例的 Label Set 不变；评估失败、Series 消失或 Label 变化会破坏状态连续性。

**问题：Recording Rule 能否降低写入量？**

答案：它会新增预计算 Series，本身增加写入；只有配合删除原始高维数据或在长期存储前降维时，整体数据量才可能下降。

## 13. 参考资料

- [Recording Rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/)
- [Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Unit Testing Rules](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/)
