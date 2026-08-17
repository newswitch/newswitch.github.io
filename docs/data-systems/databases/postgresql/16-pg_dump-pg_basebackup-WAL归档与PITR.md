---
title: "pg_dump、pg_basebackup、WAL Archive 与 PITR"
sidebar_position: 16
tags: [PostgreSQL, Backup, PITR, pg_dump, pg_basebackup]
description: "设计 PostgreSQL 逻辑/物理备份、WAL 归档、时间点恢复和恢复验收。"
---

# pg_dump、pg_basebackup、WAL Archive 与 PITR

备份只有在独立环境成功恢复并通过校验后才成立。

| 方式 | 粒度 | 用途 | 限制 |
| --- | --- | --- | --- |
| pg_dump | database/object | 迁移、选择恢复 | 大库恢复慢，不含集群全部状态 |
| pg_dumpall globals | roles/tablespaces | 配合集群迁移 | Secret/权限需保护 |
| pg_basebackup | 整个实例 | 物理副本/基础备份 | 同大版本/平台约束 |
| Base backup + WAL | 时间点 | PITR/灾备 | 必须保证连续 WAL 链 |

## 逻辑备份

Custom/directory 格式支持 `pg_restore` 并行和选择对象。备份时记录工具版本、snapshot、扩展、roles、tablespaces；恢复顺序处理 owner/ACL/extension，并执行 ANALYZE。

## 物理与归档

Base backup 提供起点，archive_command 将完成 WAL 段安全复制到独立存储。命令需幂等、校验且同名不同内容拒绝覆盖。监控 `pg_stat_archiver`、归档延迟和 `pg_wal` 空间。

## PITR

```text
restore base backup
→ configure restore_command
→ set recovery target time/LSN/name
→ replay WAL
→ pause/verify target
→ promote → new timeline
```

先恢复到隔离网络，避免旧应用误连。按业务表计数、约束、关键事务和最大事件版本验收，不只看数据库启动。

## 3-2-1 与安全

至少三份、两种介质、一份异地/隔离；加密、不可变保留、最小权限、校验和和删除审计。Ransomware 能访问主库凭据时不应同时能删除所有备份。

## 验收题

- pg_dump 与物理备份分别适合什么？
- 为什么 WAL 必须连续？
- PITR Promote 为什么产生新 Timeline？
- “备份任务成功”还缺什么证据？

## 参考资料

- [Backup and restore](https://www.postgresql.org/docs/18/backup.html)
- [pg_basebackup](https://www.postgresql.org/docs/18/app-pgbasebackup.html)
