---
title: "Alertmanager 分组、路由、抑制、Silence、HA 与通知模板"
sidebar_label: "07. Alertmanager 告警治理"
sidebar_position: 7
description: "沿告警从 Prometheus 到通知接收方的路径，设计分组、路由、抑制、静默和高可用。"
tags: [Alertmanager, Routing, Inhibition, Silence, HA]
---

# Alertmanager 分组、路由、抑制、Silence、HA 与通知模板

Prometheus 决定“什么状态应形成告警”，Alertmanager 负责去重、分组、路由、抑制、静默和通知。不要把业务阈值写进通知模板，也不要用 Silence 长期隐藏错误规则。

## 1. 通知路径

```text
Prometheus Alerting Rule
→ 所有Alertmanager实例
→ Route Tree匹配
→ Group聚合
→ Silence/Inhibition
→ 通知去重与重试
→ Receiver
```

根 Route 必须匹配所有告警，子 Route 按 Matcher 逐层选择。`continue: true` 会继续匹配后续兄弟节点，配置错误可能造成重复通知。

## 2. 分组时间

- `group_by`：哪些 Label 组成一条通知；
- `group_wait`：首次等待，让同源告警聚合；
- `group_interval`：同组新增告警的通知间隔；
- `repeat_interval`：持续未恢复时的重复提醒间隔。

按 `alertname, cluster, service` 分组通常比按 `instance` 更能抑制风暴，但必须让值班人员仍能看到受影响实例列表。

## 3. Inhibition 与 Silence

Inhibition 是自动依赖关系：集群整体不可达时抑制下游单实例告警。Source 与 Target 必须在 `equal` 指定的 Label 上相同。Silence 是有时间边界的人工 Matcher，必须记录创建人、原因、工单和截止时间。

## 4. HA

Alertmanager 集群通过 Gossip 复制 Silence 和通知日志，目标是至少一次通知；网络分区时宁可重复，也不漏掉关键告警。Prometheus 应配置所有 Alertmanager 实例，而不是只把请求发给一个负载均衡地址。

告警本身不会作为长期事实只保存在 Alertmanager，Prometheus 会持续重发仍在 Firing 的告警。

## 5. 模板与安全

通知包含：影响、开始时间、当前值、关键 Label、Dashboard、Runbook、Silence 链接。模板渲染失败、Webhook 超时和接收方限流都要监控。Webhook Secret、邮件凭据和聊天 Token 必须来自 Secret，并在日志中脱敏。

## 6. 验收实验

构造同服务多个实例告警，验证只收到一组通知；再触发集群级告警，验证实例告警被抑制；创建有截止时间的 Silence；停止一个 Alertmanager，确认通知继续；隔离两个实例，理解可能重复通知的 Fail-open 行为。

参考：[Alertmanager Configuration](https://prometheus.io/docs/alerting/latest/configuration/)、[High Availability](https://prometheus.io/docs/alerting/latest/high_availability/)。
