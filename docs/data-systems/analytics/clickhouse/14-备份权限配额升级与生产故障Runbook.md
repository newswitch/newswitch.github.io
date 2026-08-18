---
title: "备份恢复、权限、配额、升级与生产故障 Runbook"
sidebar_label: "14. 备份恢复、权限、配额、升级与生产故障 Runbook"
sidebar_position: 14
description: "建立 ClickHouse 备份恢复、安全、资源治理、滚动升级和故障定位闭环。"
tags: [ClickHouse, Backup, Security, Upgrade, Runbook]
---

# 备份恢复、权限、配额、升级与生产故障 Runbook

## 1. 备份 {/* #备份 */}

使用 `BACKUP/RESTORE` 或受支持工具保存表数据、DDL、用户/权限（按范围）、字典和配置依赖。副本不是备份。将备份放独立对象存储、加密和不可变保留，在新集群恢复并校验行数、业务聚合和副本。

## 2. 安全/配额 {/* #安全配额 */}

私网、TLS、最小用户/Role、行策略（如采用）、配额和 settings profiles。限制单租户 query time、rows/bytes、memory 和并发；日志脱敏 SQL 参数。

## 3. 升级 {/* #升级 */}

发布频繁，固定稳定补丁，检查不兼容 SQL/配置/Part/Keeper/客户端。每个 Shard 保持健康 Replica，逐副本升级并验证复制、查询和写入。旧版本是否能读新 Part 必须在回滚测试中证明。

## 4. Runbook {/* #runbook */}

```text
slow query → query_log → read rows/bytes → indexes → pipeline/spill
OOM → current queries → group/join/sort → concurrency/overcommit
too many parts → batch/partition → merge backlog/disk
replica readonly/lag → Keeper → replication queue → network/disk
disk full → parts/mutations/TTL/temp → protect writes → add/move capacity
```

未知情况下不要删除 detached/part/Keeper 数据；先保存 system tables、日志和磁盘目录清单。

## 5. 生产级恢复与变更验收 {/* #生产级恢复与变更验收 */}

使用当前版本支持的 BACKUP/RESTORE 或经过验证的工具，把数据、DDL、用户/角色、字典和外部依赖分别列入范围。每次备份在隔离集群恢复，核对表/分区/行数、抽样聚合、权限和查询 P99，记录 RPO/RTO。

升级前阅读每个跨越版本的 changelog，验证 Keeper、驱动、格式和集群混部兼容；一次一个节点，等待 replica/queue/merge 和用户 SLI 稳定。数据格式升级可能让直接降级不可行，回滚应使用旧集群与双写/回放或已验证备份。

```text
故障处理：定义影响 -> 暂停高成本变更 -> 保存 query/part/replica/keeper/OS 证据
          -> 单变量缓解 -> 行数与查询正确性验证 -> 清理积压 -> 复盘
```

权限按只读、写入、DDL、备份和运维拆分；配额同时限制查询时间、读取量、内存和并发。Runbook 禁止把 `KILL`、删除 part/Keeper 元数据或全体重启当成第一步。

## 6. 验收题 {/* #验收题 */}

- 副本为何不能防误删除？
- 配额如何保护多租户？
- Replica lag 应查看哪些系统表？
- 回滚为何要验证 Part 格式？

## 7. 参考资料 {/* #参考资料 */}

- [Backup and restore](https://clickhouse.com/docs/operations/backup)
- [Troubleshooting](https://clickhouse.com/docs/guides/troubleshooting)
