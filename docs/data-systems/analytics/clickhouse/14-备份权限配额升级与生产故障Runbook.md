---
title: "备份恢复、权限、配额、升级与生产故障 Runbook"
sidebar_position: 14
tags: [ClickHouse, Backup, Security, Upgrade, Runbook]
description: "建立 ClickHouse 备份恢复、安全、资源治理、滚动升级和故障定位闭环。"
---

# 备份恢复、权限、配额、升级与生产故障 Runbook

## 备份

使用 `BACKUP/RESTORE` 或受支持工具保存表数据、DDL、用户/权限（按范围）、字典和配置依赖。副本不是备份。将备份放独立对象存储、加密和不可变保留，在新集群恢复并校验行数、业务聚合和副本。

## 安全/配额

私网、TLS、最小用户/Role、行策略（如采用）、配额和 settings profiles。限制单租户 query time、rows/bytes、memory 和并发；日志脱敏 SQL 参数。

## 升级

发布频繁，固定稳定补丁，检查不兼容 SQL/配置/Part/Keeper/客户端。每个 Shard 保持健康 Replica，逐副本升级并验证复制、查询和写入。旧版本是否能读新 Part 必须在回滚测试中证明。

## Runbook

```text
slow query → query_log → read rows/bytes → indexes → pipeline/spill
OOM → current queries → group/join/sort → concurrency/overcommit
too many parts → batch/partition → merge backlog/disk
replica readonly/lag → Keeper → replication queue → network/disk
disk full → parts/mutations/TTL/temp → protect writes → add/move capacity
```

未知情况下不要删除 detached/part/Keeper 数据；先保存 system tables、日志和磁盘目录清单。

## 验收题

- 副本为何不能防误删除？
- 配额如何保护多租户？
- Replica lag 应查看哪些系统表？
- 回滚为何要验证 Part 格式？

## 参考资料

- [Backup and restore](https://clickhouse.com/docs/operations/backup)
- [Troubleshooting](https://clickhouse.com/docs/guides/troubleshooting)
