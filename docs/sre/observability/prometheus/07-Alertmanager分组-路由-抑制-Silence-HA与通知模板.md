---
title: "Alertmanager 分组、路由、抑制、Silence、HA 与通知模板"
sidebar_label: "07. Alertmanager 告警治理"
sidebar_position: 7
description: "跟踪告警从 Prometheus 到接收方的完整状态，掌握路由树、分组定时器、抑制、静默、通知重试和高可用边界。"
tags: [Alertmanager, Routing, Inhibition, Silence, HA]
---

# Alertmanager 分组、路由、抑制、Silence、HA 与通知模板

Prometheus 决定“哪些 Label Set 当前满足告警条件”，Alertmanager 负责去重、分组、路由、抑制、静默和通知。Alertmanager 不重新计算 PromQL，也不会把错误告警规则变正确。

```text
Prometheus持续发送Firing/Resolved告警
→ Alertmanager接收并按Fingerprint去重
→ 遍历Route Tree
→ 按group_by形成通知组
→ 检查Silence、Inhibition和Mute Interval
→ 等待分组定时器
→ 调用Receiver
→ 记录通知状态并按策略重试
```

## 1. 告警身份与去重

告警实例由完整 Label Set 标识。Annotations 变化不会产生新实例，Label 变化会。因此不要把当前值、时间戳、Pod UID 或动态文本放在 Label 中。

多个 Prometheus HA 副本向同一组 Alertmanager 发送具有相同业务 Label 的告警时，Alertmanager 可以去重。每个副本特有的 External Label 需要在架构中正确处理，避免同一事件变成两条通知。

## 2. Route Tree 如何匹配

```yaml
route:
  receiver: default
  group_by: [alertname, cluster, service]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: database-oncall
      matchers:
        - team="database"
        - severity=~"page|critical"
    - receiver: security-audit
      matchers:
        - team="security"
      continue: true
```

根 Route 必须匹配所有告警。子 Route 按配置顺序检查；命中后默认停止检查后续兄弟节点，`continue: true` 才继续。未命中任何子节点时，由当前父节点处理。

子 Route 未显式设置的 Receiver、Group 和时间参数会继承父节点。审查配置时必须展开继承后的实际语义，而不是只看局部几行。

## 3. 三个分组时间参数

| 参数 | 定时器从何时开始 | 作用 |
| --- | --- | --- |
| `group_wait` | 新通知组首次出现 | 等待同源告警或抑制源到达 |
| `group_interval` | 首次通知之后 | 检查同组新增/恢复告警并发送更新 |
| `repeat_interval` | 上次通知之后 | 没有变化但仍 Firing 时重复提醒 |

`group_wait` 太短可能先发出大量实例告警，随后集群级告警才到达，错过抑制机会；太长会推迟关键 Page。告警若在 `group_wait` 内恢复，可能不会发通知，这正是减少短抖动噪声的一部分。

分组键过细会形成风暴，过粗会把不同故障揉在一起。通常保留 `alertname、cluster、service`，在通知正文中列出实例，而不是按 `pod` 分组。

## 4. Inhibition 是依赖关系

```yaml
inhibit_rules:
  - source_matchers:
      - alertname="ClusterUnavailable"
      - severity="page"
    target_matchers:
      - severity=~"page|warning"
    equal: [cluster]
```

当同一 `cluster` 的集群不可用告警存在时，抑制其下游实例告警。Source 与 Target 必须在 `equal` Label 上值相同；两侧都缺少某个 Equal Label 时会被视为相等，因此关键 Label 缺失可能造成误抑制。

抑制只阻止通知，不会让目标告警从 Alertmanager 消失。恢复源告警后，如果目标仍 Firing，它会重新具备通知资格。

## 5. Silence 与 Mute Time

Silence 是带开始/结束时间的 Matcher 集合，适合维护窗口或已知事件：

```bash
amtool silence add \
  alertname=~'Node.*' cluster=prod-a \
  --duration=2h \
  --comment='CHG-20261010 kernel upgrade'
```

Silence 必须记录创建人、变更/故障编号、作用范围和到期时间。禁止使用无截止时间的宽泛正则长期隐藏坏规则。

Mute Time Interval 适合固定非工作时间的通知策略，但关键业务不可用不能仅因夜间被静默；可路由到不同接收方或严重级别。

## 6. Receiver 和通知重试

Receiver 可以是 Email、Webhook、Pager、Chat 等。发送成功只说明接收端 API 接受了请求，不证明人已经响应。需要对通知延迟、失败率、重试、接收方限流以及值班确认另外观测。

Webhook 必须具备：

- 认证、TLS 校验和 Secret 轮换；
- 明确的连接和响应超时；
- 幂等处理，允许重复通知；
- 限流和退避，避免接收方故障反压；
- 对 Firing/Resolved 状态正确处理。

## 7. 通知模板

通知至少包含：影响对象、严重程度、开始时间、当前状态、关键 Label、Dashboard、Runbook 和 Silence 链接。

```yaml
receivers:
  - name: platform-webhook
    webhook_configs:
      - url_file: /etc/alertmanager/secrets/platform-webhook-url
        send_resolved: true
```

Secret 使用文件或平台 Secret 注入，不写入 Git 和日志。模板渲染失败会导致通知失败；模板变更也要经过测试。

## 8. 高可用的真实边界

Alertmanager 实例通过 Gossip 共享 Silence 和通知状态，但网络分区时倾向于“可能重复、尽量不漏”：

```text
Prometheus A ─┬→ Alertmanager 1
Prometheus B ─┼→ Alertmanager 2
              └→ Alertmanager 3
Alertmanager之间建立Cluster Mesh
```

Prometheus 应知道所有 Alertmanager 实例，而不是只通过一个普通负载均衡地址发送。负载均衡只发给单个实例会削弱端到端冗余。

Alertmanager HA 不是告警历史数据库。Prometheus 会持续重新发送仍 Firing 的告警；事件审计和长期分析应进入外部系统。

## 9. 配置校验与重载

```bash
amtool check-config /etc/alertmanager/alertmanager.yml
curl -X POST http://127.0.0.1:9093/-/reload
amtool config routes show --alertmanager.url=http://127.0.0.1:9093
```

无效重载不会替换当前有效配置，但必须对重载失败告警。发布前用样例告警验证实际路由、继承、`continue` 和抑制，而不是只通过 YAML 语法检查。

## 10. 自监控和故障判断

重点观察：

- 各 Receiver 通知总数、失败数和延迟；
- Cluster Member 数与 Peer 状态；
- 活跃 Silence 数和过期清理；
- Prometheus 向 Alertmanager 发送失败；
- Alertmanager 配置哈希与 Reload 结果；
- 告警接收后到通知发送的端到端延迟。

| 现象 | 检查顺序 |
| --- | --- |
| Prometheus 显示 Firing，Alertmanager 没有 | Prometheus Alertmanager Discovery、网络、TLS、发送错误 |
| Alertmanager 有告警但没通知 | Route、Silence、Inhibition、时间窗口、Receiver |
| 重复通知 | Label 不同、HA 分区、接收方非幂等、Repeat 配置 |
| 通知风暴 | Group Key 过细、实例级告警、上游依赖未抑制 |
| 恢复通知缺失 | `send_resolved`、Group Interval、告警身份变化 |

## 11. 演练与答案

依次构造同一服务 20 个实例告警、集群级告警、一个短期 Silence、Receiver 返回 429、停止一个 Alertmanager 和隔离 Cluster Peer。记录通知数量、延迟、是否抑制以及是否重复。

**问题：Silence 会让 Prometheus 中的 Firing 告警消失吗？**

答案：不会。Silence 只在 Alertmanager 通知阶段匹配并静默。

**问题：为什么 Alertmanager 网络分区时可能重复通知？**

答案：实例无法共享完整通知状态，为了避免关键告警完全丢失，会牺牲严格去重，接收方必须幂等。

## 12. 参考资料

- [Alertmanager Concepts](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [Alertmanager Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [Alertmanager High Availability](https://prometheus.io/docs/alerting/latest/high_availability/)
