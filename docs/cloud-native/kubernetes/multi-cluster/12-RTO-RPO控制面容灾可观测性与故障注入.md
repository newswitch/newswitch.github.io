---
title: "RTO、RPO、控制面容灾、可观测性与故障注入"
sidebar_label: "12. 多集群容灾与故障注入"
sidebar_position: 12
description: "分别定义控制面、推理和训练的数据损失与恢复目标，并用分层故障注入验证设计。"
tags: [RTO, RPO, 多集群, 容灾, 故障注入]
---

# RTO、RPO、控制面容灾、可观测性与故障注入

## 1. 一个系统有多组 RTO/RPO

| 对象 | RTO | RPO |
| --- | --- | --- |
| 全局控制面 | 恢复新准入/放置的时间 | 可丢失的任务/策略状态 |
| 在线推理 | 恢复满足 SLO 流量的时间 | 通常请求状态不持久，关注会话/审计 |
| 分布式训练 | 从 Checkpoint 恢复 Step 的时间 | 最后有效 Checkpoint 之后的训练进度 |
| 模型/数据 | 目标集群具备版本的时间 | 可接受的版本落后 |

不能用一个“平台 RTO=30 分钟”代表所有层。

## 2. 控制面备份

备份全局数据库、CRD、策略、证书元数据和发布清单。恢复需要验证 Schema、Encryption Key、身份系统、成员注册和实际状态 Reconciliation。直接恢复旧快照可能把已经结束的任务重新视为 Running。

## 3. 成员自治

Hub 故障时，成员继续运行已有训练和推理；冻结高风险全局变更；本地 HPA/Controller 按预定边界工作。Hub 恢复后使用 UID、Generation 和时间线合并状态。

## 4. 可观测性

- Hub/成员 Heartbeat 和数据新鲜度；
- 状态传播、Queue、Placement 延迟；
- 模型和 Dataset 复制 Lag；
- 每集群容量、SLO 和错误预算；
- 跨集群请求/任务 Correlation ID；
- Failover、Fencing 和重复状态事件。

跨区域监控自身也可能断链；成员应保留本地指标和日志，恢复后可查询故障窗口。

## 5. 故障注入矩阵

```text
Hub进程/数据库故障
成员API不可达
Hub与成员网络分区
Registry/Object Store不可用
整个Region出口故障
目标集群容量不足
Checkpoint复制延迟/损坏
DNS/GTM部分缓存未更新
```

每次只改变一个主要变量，设置停止条件，不在没有 N+1 容量时对生产全量注入。

## 6. 验收证据

记录触发时间、检测时间、停止新流量/任务时间、目标集群 Ready、恢复完成、实际数据损失、旧执行者是否被 Fencing，以及恢复期间 SLO。用时间线计算实际 RTO/RPO，而不是填写预期值。

## 7. 回切

原集群恢复后先同步模型、数据和状态，运行 Canary，再逐步回切。避免双向切换振荡，使用稳定观察窗口和容量 Hysteresis。

参考：[Kubernetes Multi-Cluster Services API](https://multicluster.sigs.k8s.io/concepts/multicluster-services-api/)、[Karmada Failover](https://karmada.io/docs/userguide/failover/application-failover/)。
