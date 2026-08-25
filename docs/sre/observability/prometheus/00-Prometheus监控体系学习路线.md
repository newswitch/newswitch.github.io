---
title: "Prometheus 监控体系学习路线"
sidebar_label: "00. Prometheus 监控体系学习路线"
sidebar_position: 0
description: "从指标、标签、抓取和 TSDB 入门，进阶到 PromQL、规则、Alertmanager、Grafana、高可用、远程存储、容量和生产排障。"
tags: [Prometheus, Alertmanager, Grafana, PromQL, 监控, 学习路线]
---

# Prometheus 监控体系学习路线

Prometheus 体系不只是一个 Grafana 看板。它包含应用埋点、Exporter、服务发现、Scrape、时序存储、PromQL、Recording/Alerting Rule、Alertmanager 和可视化。

```text
Application / Exporter
→ /metrics
→ Service Discovery与Relabel
→ Prometheus Scrape
→ Head/WAL/TSDB Block
→ PromQL与Rules
→ Alertmanager路由、抑制、分组、Silence
→ Grafana与OnCall
```

## 1. P0：指标模型与告警链路

1. [Prometheus 解决什么问题与一条指标的完整路径](./01-Prometheus解决什么问题与一条指标的完整路径.md)
2. [Counter、Gauge、Histogram、Summary 与标签基数](./02-Counter-Gauge-Histogram-Summary与标签基数.md)
3. [Instrumentation、Exporter、文本格式、Scrape 与服务发现](./03-Instrumentation-Exporter-文本格式-Scrape与服务发现.md)
4. [Prometheus TSDB、Head、WAL、Block、Compaction 与 Retention](./04-Prometheus-TSDB-Head-WAL-Block-Compaction与Retention.md)
5. [PromQL：Selector、Range、Rate、聚合、Join、Subquery 与 Histogram](./05-PromQL-Selector-Range-Rate-聚合-Join-Subquery与Histogram.md)
6. [Recording Rule、Alerting Rule、`for`、`keep_firing_for` 与规则测试](./06-Recording-Rule-Alerting-Rule-for-keep_firing_for与规则测试.md)
7. [Alertmanager 分组、路由、抑制、Silence、HA 与通知模板](./07-Alertmanager分组-路由-抑制-Silence-HA与通知模板.md)
8. [Grafana Data Source、Dashboard、Variable、Annotation 与告警联动](./08-Grafana-Data-Source-Dashboard-Variable-Annotation与告警联动.md)

## 2. P1：部署、扩展与生产运维

9. [二进制、systemd、Docker、Helm、Prometheus Operator 与 kube-prometheus-stack](./09-二进制-systemd-Docker-Helm-Prometheus-Operator与kube-prometheus-stack.md)
10. [Kubernetes ServiceMonitor、PodMonitor、Probe 与抓取故障](./10-Kubernetes-ServiceMonitor-PodMonitor-Probe与抓取故障.md)
11. [Federation、Remote Write、Agent Mode、Thanos 与 Mimir 选型](./11-Federation-Remote-Write-Agent-Mode-Thanos与Mimir选型.md)
12. [Series、Samples、WAL、查询并发、容量规划与性能优化](./12-Series-Samples-WAL-查询并发-容量规划与性能优化.md)
13. [TLS、认证、NetworkPolicy、Secret、租户和指标数据安全](./13-TLS-认证-NetworkPolicy-Secret-租户与指标数据安全.md)
14. [Snapshot、备份、升级、迁移、版本兼容与回滚](./14-Snapshot-备份-升级-迁移-版本兼容与回滚.md)

## 3. P2：故障与工程化

15. [Prometheus、Alertmanager、Grafana 生产故障 Runbook](./15-Prometheus-Alertmanager-Grafana生产故障Runbook.md)

## 4. 学习时始终回答四个问题

```text
指标是谁产生的？
Prometheus为什么能找到并抓到它？
样本怎样形成时序并被查询？
异常怎样变成一个可执行告警？
```

## 5. 必做实验

- 编写 Counter、Gauge 和 Histogram 指标；
- 故意加入用户 ID 标签，观察基数增长；
- 配置静态 Target 和 Kubernetes ServiceMonitor；
- 让 Target 连接失败、超时和返回错误格式；
- 使用 `rate`、`increase`、`histogram_quantile` 和向量匹配；
- 编写 Recording/Alerting Rule 并用 `promtool test rules` 测试；
- 配置 Alertmanager 路由、抑制和 Silence；
- 重启 Prometheus，观察 WAL Replay；
- 制造磁盘水位、慢查询和远程写积压；
- 完成 Snapshot、升级和回滚演练。

## 6. 学习完成标准

- 能解释 metric name 与 labels 怎样唯一标识一条时序；
- 能正确选择 Counter、Gauge、Histogram 和 Summary；
- 能发现高基数和无界标签；
- 能画出服务发现、Relabel、Scrape 和 TSDB 写入路径；
- 能写出可验证的 PromQL 与多窗口燃烧率告警；
- 能设计 Alertmanager 分组、抑制、路由和 HA；
- 能部署 Prometheus Operator 并排查 Target Down；
- 能根据 active series、samples/s、retention 和查询负载规划容量；
- 能在单机、Thanos/Mimir 和远程写方案之间选择；
- 能完成监控系统自身的监控和故障恢复。
