---
title: "Snapshot、备份、升级、迁移、版本兼容与回滚"
sidebar_label: "14. 备份、升级与迁移"
sidebar_position: 14
description: "区分配置、告警状态和 TSDB 数据，设计 Prometheus 体系可验证的备份、升级和回滚流程。"
tags: [Prometheus, Snapshot, 备份, 升级, 回滚]
---

# Snapshot、备份、升级、迁移、版本兼容与回滚

监控系统的首要恢复目标通常是尽快重新抓取和告警，其次才是历史查询。配置、规则、Dashboard、Silence 和 TSDB 数据需要不同的保护方式。

## 1. 状态分类

| 状态 | 保护方式 |
| --- | --- |
| Prometheus 配置/规则 | Git、IaC、Secret 备份、promtool 测试 |
| Grafana Dashboard/Data Source | Provisioning、导出、数据库备份 |
| Alertmanager Silence/nflog | 实例持久卷、HA 副本、必要时 API 导出 |
| Prometheus TSDB | Snapshot、存储快照或远程长期存储 |
| Thanos/Mimir 历史数据 | 对象存储版本/复制及组件元数据 |

## 2. Snapshot

启用 Admin API 后可创建 TSDB Snapshot。操作前检查磁盘空间和权限，Snapshot 完成后复制到独立故障域并记录版本、时间范围和校验值。只复制运行中数据目录不是可靠备份流程。

本地 Snapshot 不能替代长期高可用：Prometheus 单机故障到恢复期间仍会产生抓取空洞，除非有独立副本或远程数据路径。

## 3. 升级流程

1. 阅读 Breaking Changes、Feature Flag 和存储格式说明；
2. 备份配置、规则、Dashboard、Alertmanager 状态和必要数据；
3. 在预发布用真实配置执行新版本；
4. `promtool` 检查并比较 PromQL/Rule 结果；
5. 先升级一个 HA 副本，观察抓取、WAL、规则和远程写；
6. 灰度 Alertmanager/Grafana/Operator；
7. 确认回滚仍兼容后再全量。

Operator CRD 升级、Helm Values 和组件版本是不同变更面，应分开核对。

## 4. 迁移

迁移本地 Prometheus 时可让新旧实例短期双抓，比较 Target、Active Series、Rule 和告警；历史数据优先通过远程存储或 Snapshot 迁移。避免让两个实例共写同一 TSDB 目录。

## 5. 恢复验收

恢复后验证 Targets、Rule、Alertmanager 路由、Dashboard、历史时间范围和远程写追赶。主动触发一条测试告警，证明通知链路恢复；仅看到进程 Running 不算完成。

参考：[Prometheus Management API](https://prometheus.io/docs/prometheus/latest/querying/api/#tsdb-admin-apis)。
