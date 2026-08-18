---
title: "监控、滚动升级、红黄集群与生产故障 Runbook"
sidebar_label: "16. 监控、滚动升级、红黄集群与生产故障 Runbook"
sidebar_position: 16
description: "从端到端 SLO 定位 Elasticsearch 节点、Shard、JVM、磁盘与查询故障。"
tags: [Elasticsearch, Monitoring, Upgrade, Runbook]
---

# 监控、滚动升级、红黄集群与生产故障 Runbook

## 1. 监控层次 {/* #监控层次 */}

```text
client: latency/errors/retries/result size
cluster: health/state tasks/master stability
shard: allocation/recovery/segments/merge
node: JVM/GC/CPU/disk/network/thread pools
workload: indexing/search/bulk/slow log/tasks
lifecycle: ILM/snapshot/CCR/security
```

## 2. Runbook {/* #runbook */}

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

## 3. 滚动升级 {/* #滚动升级 */}

检查升级路径、deprecated APIs/settings、插件、Stack 版本和 Snapshot。按官方节点顺序逐个故障域升级，每步等待节点加入、Shard 恢复和业务 SLO。控制不必要 rebalance 但不要长期留下禁用设置。

Elasticsearch 通常不支持原地降级。回滚依赖停止推进、兼容节点或从升级前 Snapshot 恢复旧版本独立集群。

## 4. 证据保存 {/* #证据保存 */}

事故开始保存 cluster state 摘要、allocation explain、nodes stats、tasks、hot threads、GC/系统指标、Slowlog 和变更记录。Hot threads/日志可能含查询内容，需脱敏。

## 5. 生产 Runbook 的执行模板 {/* #生产-runbook-的执行模板 */}

```text
1. 定义：影响租户、错误率/P99、开始时间、最近变更
2. 保护：限流/暂停非关键写入，禁止并行高风险操作
3. 取证：health、shards、allocation explain、nodes stats、hot threads、日志
4. 定位：控制面、写入、查询、JVM、磁盘、网络或依赖
5. 单变量缓解：记录命令、操作者、预期和回滚点
6. 验证：用户 SLI、集群水位、积压和数据正确性恢复
```

滚动升级前读取每个跨越版本的 release notes/deprecations，完成 snapshot 恢复验证，检查插件和客户端兼容性。一次只升级一个节点，遵循官方节点角色顺序；每步等待 cluster health、recovery 和负载稳定。升级通常不能通过把旧二进制直接覆盖 data path 回滚，因此必须准备快照恢复或旧集群回切。

告警应围绕持续的用户影响和耗尽趋势：不可用、写入/查询错误、P99、unassigned primary、磁盘水位、GC/rejection、任务积压。单个瞬时 CPU 峰值只做上下文，不应直接触发破坏性处置。

## 6. 验收题 {/* #验收题 */}

- Red 时为什么先 allocation explain 而非强制分配？
- CPU 低但查询慢可在哪些队列/I/O？
- 滚动升级为何每步等待恢复？
- 为什么旧镜像不是可靠降级方案？

## 7. 参考资料 {/* #参考资料 */}

- [Troubleshooting](https://www.elastic.co/docs/troubleshoot/elasticsearch)
- [Upgrade Elasticsearch](https://www.elastic.co/docs/deploy-manage/upgrade/deployment-or-cluster/elasticsearch)
