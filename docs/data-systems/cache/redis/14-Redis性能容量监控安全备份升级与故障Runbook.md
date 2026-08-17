---
title: "性能、容量、监控、安全、备份、升级与故障 Runbook"
sidebar_label: "14. 性能、容量、监控、安全、备份、升级与故障 Runbook"
sidebar_position: 14
tags: [Redis, 性能, 容量规划, 安全, Runbook]
description: "建立 Redis 从 SLO、基准、容量、监控到备份升级和故障恢复的生产闭环。"
---

# 性能、容量、监控、安全、备份、升级与故障 Runbook

## SLO 与基准

分别定义 GET/SET/脚本/批量请求的 P50/P95/P99、错误率和可用性。压测使用真实 key/value、Pipeline、连接数、TLS 和读写比例，并同时运行持久化、复制和故障恢复。

容量至少包含：

```text
logical dataset × measured memory amplification
+ allocator/fork/client/replication headroom
+ AOF/RDB disk and rewrite temporary space
+ network peak and replica sync
```

## 监控四层

- 客户端：池等待、超时、重试、命中率、请求分位数；
- Redis：命令、latency、slowlog、CPU、memory、eviction、clients；
- 数据：key 数、TTL、热/大 Key、复制 offset、持久化；
- 系统：cgroup、RSS、磁盘 fsync、网络重传、时钟和故障域。

## 安全

仅内网监听，启用 TLS、ACL 最小权限和 Secret 轮换；禁用/限制危险管理命令不能替代网络隔离。审计配置变更和 ACL 失败，不记录敏感 value。

## 备份与升级

副本不是备份。保存校验后的 RDB/AOF 集合、配置、ACL、模块和版本，异机恢复并执行数据/业务校验。升级先读兼容说明，副本滚动、受控切换，再升级旧主；Cluster 保持每个 slot 有健康副本。

## Runbook

```text
P99 high → client wait/RTT → command/CPU → fork/fsync → memory/eviction
OOM      → cgroup/RSS → COW/buffer → maxmemory/policy → traffic protection
replica down → network/auth → backlog → full sync resources → data gap
AOF error → stop unsafe writes → disk/permission → preserve files → restore
cluster fail → slots/quorum → node links → replica eligibility → controlled repair
```

任何修复先保留日志、INFO、拓扑和持久化文件，不在未知路径上删除数据。

## 验收题

- 平均延迟和单机 QPS 为什么不能代表容量？
- 副本、RDB/AOF 与离线备份分别解决什么？
- Redis CPU 低但 P99 高时按什么顺序排查？
- 升级回滚为什么需要数据格式验证？

## 参考资料

- [Redis administration](https://redis.io/docs/latest/operate/oss_and_stack/management/)
- [Redis latency monitoring](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency-monitor/)
