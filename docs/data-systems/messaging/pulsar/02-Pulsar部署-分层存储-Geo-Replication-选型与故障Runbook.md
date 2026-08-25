---
title: "Pulsar 部署、分层存储、Geo-Replication、选型与故障 Runbook"
sidebar_label: "02. 生产部署与故障 Runbook"
sidebar_position: 2
description: "掌握 Pulsar 生产拓扑、容量、安全、分层存储、跨地域复制和故障定位。"
tags: [Pulsar, Deployment, Tiered Storage, Geo Replication]
---

# Pulsar 部署、分层存储、Geo-Replication、选型与故障 Runbook

## 1. 生产拓扑

Broker 无状态但依赖 Metadata Store 与 BookKeeper；Bookie 使用独立 Journal 与 Ledger 磁盘并开启机架/可用区感知；Metadata Store 使用奇数节点保持多数派。Kubernetes 部署还要给 Bookie 稳定 PV、反亲和和可控滚动策略。

不要把 Bookie 的高吞吐 Ledger 和低延迟 Journal 随意放在同一受限云盘上；通过磁盘延迟和故障实验验证，而不是只看规格表。

## 2. 容量模型

入口带宽 `W` 经过副本后，Bookie 总写入至少近似 `W × Write Quorum`，再加 Journal、索引和恢复流量。存储按入口速率、保留时长、副本、压缩率与 Backlog 峰值估算。Broker 主要看连接、消息率、协议处理、缓存和分发带宽。

## 3. 分层存储与跨地域

Tiered Storage 把关闭 Ledger 卸载到对象存储，降低热盘成本，但历史读取受对象存储延迟、带宽和 API 影响。Geo-Replication 在集群间异步复制消息，提供地域容灾，不等于零 RPO；还要同步 Tenant/Namespace/Schema 等管理配置。

## 4. 安全与升级

启用 TLS、Authentication、Authorization；按 Tenant/Namespace 最小授权；管理 API 与数据面分离。升级按 Metadata、Bookie、Broker 的兼容文档滚动，确保写入 Quorum 和 Broker 容量在任一节点下线时仍够用。

## 5. Runbook

```text
生产延迟升高
→ Broker是否有连接/CPU/GC瓶颈？
→ BookKeeper add_entry延迟是否升高？
→ 是否出现缺Bookie/只读/磁盘满？
→ Metadata操作是否超时？
→ 网络与机架是否形成慢Quorum？
```

消费积压先比较 Publish 与 Dispatch Rate，再检查 Consumer、Subscription 类型和 Unacked/Redelivery。Broker 失败后 Topic 迁移需要时间；若无法迁移，检查 Ownership 和 Metadata，不要直接删除 Ledger 元数据。

## 6. 选型结论

多租户、海量 Topic、计算存储分离和跨地域是核心需求，且团队能运维 BookKeeper 时可重点评估 Pulsar；若 Kafka 生态、Connector 和团队经验更关键，Kafka 通常风险更低。

参考：[Deploying Pulsar](https://pulsar.apache.org/docs/next/deploy-bare-metal/)、[Tiered Storage](https://pulsar.apache.org/docs/next/tiered-storage-overview/)、[Geo-replication](https://pulsar.apache.org/docs/next/administration-geo/)。
