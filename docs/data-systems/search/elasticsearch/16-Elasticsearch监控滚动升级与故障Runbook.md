---
title: "监控、滚动升级、红黄集群与生产故障 Runbook"
sidebar_label: "16. 监控、滚动升级、红黄集群与生产故障 Runbook"
sidebar_position: 16
tags: [Elasticsearch, Monitoring, Upgrade, Runbook]
description: "从端到端 SLO 定位 Elasticsearch 节点、Shard、JVM、磁盘与查询故障。"
---

# 监控、滚动升级、红黄集群与生产故障 Runbook

## 监控层次

```text
client: latency/errors/retries/result size
cluster: health/state tasks/master stability
shard: allocation/recovery/segments/merge
node: JVM/GC/CPU/disk/network/thread pools
workload: indexing/search/bulk/slow log/tasks
lifecycle: ILM/snapshot/CCR/security
```

## Runbook

```text
RED → identify unassigned primary → allocation explain
    → node/store/snapshot evidence → choose safe recovery
YELLOW → replica reason → failure domain/capacity/settings
P99 → client queue → thread rejection → shard fan-out/profile
    → GC/Page Cache/disk/merge → response bytes
disk watermark → stop growth → ILM/snapshot/retention
    → add capacity/relocate; never delete data files
master unstable → GC/network/state size/pending tasks
```

## 滚动升级

检查升级路径、deprecated APIs/settings、插件、Stack 版本和 Snapshot。按官方节点顺序逐个故障域升级，每步等待节点加入、Shard 恢复和业务 SLO。控制不必要 rebalance 但不要长期留下禁用设置。

Elasticsearch 通常不支持原地降级。回滚依赖停止推进、兼容节点或从升级前 Snapshot 恢复旧版本独立集群。

## 证据保存

事故开始保存 cluster state 摘要、allocation explain、nodes stats、tasks、hot threads、GC/系统指标、Slowlog 和变更记录。Hot threads/日志可能含查询内容，需脱敏。

## 验收题

- Red 时为什么先 allocation explain 而非强制分配？
- CPU 低但查询慢可在哪些队列/I/O？
- 滚动升级为何每步等待恢复？
- 为什么旧镜像不是可靠降级方案？

## 参考资料

- [Troubleshooting](https://www.elastic.co/docs/troubleshoot/elasticsearch)
- [Upgrade Elasticsearch](https://www.elastic.co/docs/deploy-manage/upgrade/deployment-or-cluster/elasticsearch)
