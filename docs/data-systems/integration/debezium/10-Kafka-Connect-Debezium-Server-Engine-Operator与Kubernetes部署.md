---
title: "Debezium 部署：Kafka Connect、Server、Engine、Operator 与 Kubernetes"
sidebar_label: "10. 部署形态与 Kubernetes"
sidebar_position: 10
description: "比较 Debezium 的四种运行形态，给出 Kubernetes 生产部署、状态保护和验收方法。"
tags: [Debezium, Kafka Connect, Kubernetes, Debezium Server]
---

# Debezium 部署：Kafka Connect、Server、Engine、Operator 与 Kubernetes

Debezium 是 CDC 引擎，不等于只能部署在 Kafka Connect。运行形态决定状态放在哪里、如何扩缩容、输出到哪里以及谁负责生命周期。

## 1. 形态选型

| 形态 | 适用场景 | 运维重点 |
| --- | --- | --- |
| Kafka Connect Distributed | Kafka 为中心、连接器多 | Worker Group、内部 Topic、插件一致性 |
| Debezium Server | 输出到 Pulsar、Kinesis、Pub/Sub 等 | Quarkus 配置、Offset/History Store |
| Embedded Engine | 应用内嵌、需要自定义处理 | 应用自己负责线程、状态和交付语义 |
| Debezium Operator | Kubernetes 声明式管理 | CR、版本兼容、状态存储和升级控制 |

不要为了 Kubernetes 就默认 Operator；先确认它对目标连接器、版本和升级路径的支持成熟度。

## 2. Kafka Connect 生产结构

```text
多个Worker Pod（同group.id）
├─ config.storage.topic
├─ offset.storage.topic
├─ status.storage.topic
└─ Connector/Task由组协调分配
```

Worker Pod 可以重建，但三个内部 Topic 和 Schema History 是持久状态。镜像必须固化 Debezium、Converter 和 SMT 插件版本；所有 Worker 插件目录一致，否则 Rebalance 后任务可能在另一 Pod 启动失败。

## 3. Kubernetes 要点

- 使用 Deployment 管 Worker，PDB 和反亲和降低同时中断；
- Readiness 不能只测 REST 端口，还要监控 Connector/Task 状态；
- CPU 限制过紧会造成 GC、心跳和 Rebalance；
- Secret 保存数据库和 Kafka 凭据，启用 TLS、NetworkPolicy；
- 滚动升级设置合理 `maxUnavailable`，避免整个 Worker Group 频繁重平衡；
- JMX/OTel 指标、日志和 Connector 配置纳入统一观测与 GitOps。

## 4. 发布与验收

先部署 Worker 并验证内部 Topic，再通过 REST/CR 创建 Connector。记录完整配置但脱敏密码。验收至少覆盖：首次快照、增量推进、Pod 删除重建、Worker Rebalance、Kafka 短时不可用、数据库断连、插件版本检查和状态恢复。

## 5. 扩容边界

单个数据库 Connector 的并行度受数据库日志顺序和连接器实现约束，增加 Worker Pod 不一定提高单 Connector 吞吐。扩容主要改善多个 Connector 的分散与故障域；单任务瓶颈应从数据库读取、转换、Queue、Kafka Produce 和事件大小逐层分析。

## 6. 升级

升级前保存镜像摘要、Connector 配置、Offset/History、兼容矩阵和回滚镜像。先用相同日志样本做预生产恢复，再滚动 Worker。升级完成以 Offset 连续、Schema 正确、无异常重放和下游对账为准。

参考：[Debezium Architecture](https://debezium.io/documentation/reference/stable/architecture.html)、[Debezium Operator](https://debezium.io/documentation/reference/stable/operations/debezium-operator.html)。
