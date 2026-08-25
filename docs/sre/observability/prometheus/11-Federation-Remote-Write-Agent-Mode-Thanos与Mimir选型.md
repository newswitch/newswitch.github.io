---
title: "Federation、Remote Write、Agent Mode、Thanos 与 Mimir 选型"
sidebar_label: "11. 全局监控与远程存储选型"
sidebar_position: 11
description: "比较分层聚合、远程写、轻量采集和全局查询方案，建立多集群监控的控制面与数据面。"
tags: [Prometheus, Federation, Remote Write, Agent Mode, Thanos, Mimir]
---

# Federation、Remote Write、Agent Mode、Thanos 与 Mimir 选型

本地 Prometheus 擅长自治抓取和短期查询；多集群长期保留需要额外的全局查询或远程存储系统。不是“装一个 Thanos”就自动获得高可用，必须明确写入、对象存储、去重和查询路径。

## 1. 方案比较

| 方案 | 数据路径 | 适用 |
| --- | --- | --- |
| Federation | 上层 Prometheus 抓下层聚合指标 | 分层汇总少量 Series |
| Remote Write | Prometheus 异步发送样本到远端 | 长期存储、多租户后端 |
| Agent Mode | 只抓取并远程写，弱化本地查询 | 边缘采集 |
| Thanos Sidecar | 本地 Block 上传对象存储，全局 Query | 保留 Prometheus 自治与历史查询 |
| Mimir | 分布式 Remote Write 后端与查询 | 大规模多租户集中平台 |

## 2. Remote Write 队列

```text
Scrape → Local TSDB/WAL → Remote Write Queue → HTTP Backend
```

远端故障会导致 Queue/WAL 积压，恢复后产生追赶流量。监控发送速率、失败、重试、Pending Samples、Shard 和最老未发送时间；限制重试风暴并保留足够 WAL 窗口。

Remote Write 成功不代表本地告警一定正常，反之远端失败也不一定影响本地抓取。两条路径应分别定义 SLO。

## 3. Thanos 路径

Sidecar 读取 Prometheus Block 并上传对象存储，Store Gateway 查询历史 Block，Query 聚合多个 Store 并按 Replica Label 去重，Compactor 下采样/压缩和执行保留。对象存储一致性、Bucket 权限和 Compactor 单实例语义必须验证。

## 4. Mimir 路径

集中接收 Remote Write，按 Tenant 鉴权、分片、持久化和查询。容量规划要覆盖 Distributor、Ingester、对象存储、缓存、Compactor、Querier 与 Query Frontend，而不是只扩一个入口。

## 5. 选型问题

- 每个集群是否需要断网自治告警？
- 全局查询新鲜度和保留期？
- Active Series、Samples/s、Tenant 数？
- 是否接受 Remote Write 链路成为唯一数据入口？
- 已有对象存储与运维能力？
- 查询去重、乱序和 Tenant 隔离要求？

## 6. 故障演练

阻断远端后端，确认本地告警继续、远程写积压可见且恢复后追平；阻断对象存储，验证近期和历史查询边界；停一个 Prometheus 副本，确认全局查询去重与告警冗余。

参考：[Prometheus Remote Write](https://prometheus.io/docs/practices/remote_write/)、[Thanos Components](https://thanos.io/tip/components/)、[Grafana Mimir Architecture](https://grafana.com/docs/mimir/latest/references/architecture/)。
