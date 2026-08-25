---
title: "Recording Rule、Alerting Rule、for、keepfiringfor 与规则测试"
sidebar_label: "06. 规则、状态机与测试"
sidebar_position: 6
description: "解释规则组执行、预计算、告警 Pending/Firing 状态、恢复保持和 promtool 单元测试。"
tags: [Prometheus, Recording Rule, Alerting Rule, promtool, 告警]
---

# Recording Rule、Alerting Rule、for、keepfiringfor 与规则测试

Recording Rule 把查询结果写成新时序，Alerting Rule 把满足条件的每个 Label Set 转换为告警实例。它们按 Rule Group 周期执行，组内规则顺序执行并共享评估时间。

## 1. Recording Rule

```yaml
groups:
  - name: api-sli
    interval: 30s
    rules:
      - record: service:http_requests:rate5m
        expr: sum by (service) (rate(http_requests_total[5m]))
```

适合预计算昂贵且反复使用的表达式，降低 Dashboard 和告警延迟。输出 Label 必须保留所需维度并限制基数；名称保持统一，例如 `level:metric:operations`。

## 2. Alerting Rule 状态

```yaml
      - alert: ApiErrorRateHigh
        expr: service:http_errors:ratio_rate5m > 0.05
        for: 10m
        keep_firing_for: 5m
        labels:
          severity: page
        annotations:
          summary: "{{ $labels.service }} error rate is high"
```

`for` 要求条件持续满足后才从 Pending 进入 Firing，用于过滤短抖动；`keep_firing_for` 在条件短暂消失后继续保持 Firing，降低数据间断造成的反复恢复。两者都不是延迟数据修正机制。

## 3. 告警表达式设计

- 同时设最小流量，避免低样本率误报；
- Label 保留 `cluster/service/namespace`，不保留 Pod UID；
- Annotation 写影响、当前值、Dashboard 与 Runbook；
- SLO 告警使用长短窗口燃烧率，而非单一瞬时阈值；
- 资源告警结合耗尽预测，不只看百分比。

## 4. 规则测试

```bash
promtool check rules rules.yml
promtool test rules rules.test.yml
```

测试文件应构造正常、越界、Counter Reset、缺样本、低流量和恢复场景，断言 Recording Series 与告警 Label/Annotation。语法通过不代表逻辑正确。

## 5. 规则运行故障

规则组执行超过 Interval 时会错过后续评估。监控规则评估失败、耗时、错过次数和输出 Series 数。查询后端延迟、远端数据到达晚或表达式基数爆炸都会造成规则空洞。

## 6. 发布流程

```text
代码评审 → promtool语法检查 → 单元测试
→ 预发布影子评估 → 灰度加载 → 验证Pending/Firing/Resolved
→ 观察通知量 → 全量
```

修改路由 Label 前同时检查 Alertmanager，否则告警可能生成但进入错误接收方。

参考：[Defining Recording and Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/)、[Unit Testing Rules](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/)。
