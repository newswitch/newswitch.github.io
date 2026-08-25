---
title: "Prometheus、Alertmanager、Grafana 生产故障 Runbook"
sidebar_label: "15. 监控体系生产 Runbook"
sidebar_position: 15
description: "从指标源、抓取、TSDB、查询、规则、Alertmanager 到 Grafana 分层定位监控系统故障。"
tags: [Prometheus, Alertmanager, Grafana, Runbook, 故障排查]
---

# Prometheus、Alertmanager、Grafana 生产故障 Runbook

监控系统故障会让业务进入“盲飞”，但看板空白并不一定代表业务故障。处理时先启用独立健康通道和业务探测，再定位遥测链路。

## 1. 前五分钟

1. 确认是单 Panel、单指标、单 Target、单 Prometheus 还是整套系统；
2. 用独立黑盒探测确认业务真实状态；
3. 冻结规则、Dashboard、Relabel 和升级变更；
4. 保存 Prometheus/Alertmanager/Grafana 日志和关键自监控指标；
5. 检查磁盘、内存、WAL Replay、Remote Write、规则评估和通知队列；
6. 通知值班团队当前监控覆盖缺口。

## 2. 分层决策树

```text
数据/告警异常
├─ /metrics无数据 → 应用/Exporter
├─ Target Down → 发现、DNS、网络、TLS、超时
├─ Target Up但查询无数据 → Relabel、Label、时间、TSDB
├─ PromQL慢/失败 → 基数、时间范围、Join、并发
├─ Rule未Firing → 表达式、for、评估失败、缺样本
├─ Firing无通知 → AM路由、Silence、Inhibition、Receiver
└─ Grafana空白 → Data Source、变量、权限、查询
```

## 3. 重点场景

### 3.1 磁盘满

限制高成本查询和非关键抓取，确认 Retention、WAL、Block 与 Compaction。扩容或按受控 Retention 清理，禁止手工随机删除 Block/WAL。

### 3.2 WAL Replay/OOM

给启动留足时间并观察 Replay，检查 Active Series 是否突增。若是高基数变更，先在源头或 Metric Relabel 阻断，再按证据处理数据恢复。

### 3.3 告警风暴

先判断是否真实大故障，使用上游根因告警 Inhibition；紧急 Silence 必须有到期时间。随后修正 Label 分组和规则，而非永久静默。

### 3.4 Remote Write 积压

确认本地抓取是否正常、WAL 保留窗口和远端状态；恢复时限制追赶对正常流量的影响。

## 4. 恢复验收

- 独立探测与监控数据一致；
- Targets、Rule Evaluation 和 Alertmanager 全健康；
- 测试告警完成 Firing、通知和 Resolved；
- 查询 P99 与 Dashboard 恢复；
- Remote Write 追平，无样本持续丢弃；
- 临时 Silence、限流和权限已回收。

## 5. 演练

定期注入 Exporter 超时、证书错误、高基数、磁盘水位、WAL Replay、规则失败、Alertmanager 分区和 Webhook 超时。复盘以“监控失明持续时间”和“用户影响发现延迟”为核心指标。

参考：[Prometheus Troubleshooting](https://prometheus.io/docs/prometheus/latest/querying/basics/)、[Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)。
