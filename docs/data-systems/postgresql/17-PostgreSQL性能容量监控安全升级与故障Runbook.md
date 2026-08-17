---
title: "性能、容量、监控、安全、升级与故障 Runbook"
sidebar_position: 17
tags: [PostgreSQL, 性能, 容量, 安全, Runbook]
description: "建立 PostgreSQL SLO、容量、监控、安全、升级和事故响应闭环。"
---

# 性能、容量、监控、安全、升级与故障 Runbook

## SLO 和容量

按事务类型定义吞吐、P95/P99、错误和可用性。容量模型包含数据/索引/膨胀、WAL/备份、连接/并发内存、CPU、存储 IOPS/吞吐/fsync、复制恢复和维护余量。

压测使用真实数据倾斜、事务、索引、连接池和冷/热缓存，包含 checkpoint、Vacuum、备份与故障切换。

## 监控

```text
application → pool wait, tx latency, retries
sessions    → pg_stat_activity, waits, xact age
SQL         → pg_stat_statements, plans, temp, WAL
storage     → table/index/bloat, IO, checkpoint
replication → LSN lag, slots, conflicts
system      → CPU, RSS, cache, disk latency, network
```

## 安全

私网、TLS、SCRAM/证书、最小 Role、固定 search_path、Secret 轮换、审计 DDL/权限。限制扩展和超级用户；备份同样加密和访问审计。

## 升级

小版本按滚动/维护流程；大版本选 pg_upgrade、逻辑复制或 dump/restore。检查 extension/driver/SQL 行为、磁盘余量和统计，演练回滚。`pg_upgrade --link` 使旧集群文件被共享/改变，回滚边界要特别明确。

## Runbook

```text
latency → pool/wait → blockers → top SQL/plan → IO/checkpoint
disk full → stop growth → WAL/slot/archive/temp → safe capacity recovery
replica lag → receive/write/flush/replay → IO/query conflict/network
corruption → preserve evidence → isolate → checksum/log → restore
failover → fence old primary → validate LSN/timeline → route → rebuild old
```

## 验收题

- CPU 低而 P99 高时最先查什么？
- WAL、Slot、Temp 分别怎样填满磁盘？
- 大版本升级有哪些迁移方式？
- 恢复后怎样证明业务数据正确？

## 参考资料

- [Monitoring](https://www.postgresql.org/docs/18/monitoring.html)
- [Upgrading](https://www.postgresql.org/docs/18/upgrading.html)
