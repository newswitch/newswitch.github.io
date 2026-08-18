---
title: "pgdump、pgbasebackup、WAL Archive 与 PITR"
sidebar_label: "16. pgdump、pgbasebackup、WAL Archive 与 PITR"
sidebar_position: 16
description: "设计 PostgreSQL 逻辑/物理备份、WAL 归档、时间点恢复和恢复验收。"
tags: [PostgreSQL, Backup, PITR, pg_dump, pg_basebackup]
---

# pgdump、pgbasebackup、WAL Archive 与 PITR

备份只有在独立环境成功恢复并通过校验后才成立。

| 方式 | 粒度 | 用途 | 限制 |
| --- | --- | --- | --- |
| pg_dump | database/object | 迁移、选择恢复 | 大库恢复慢，不含集群全部状态 |
| pg_dumpall globals | roles/tablespaces | 配合集群迁移 | Secret/权限需保护 |
| pg_basebackup | 整个实例 | 物理副本/基础备份 | 同大版本/平台约束 |
| Base backup + WAL | 时间点 | PITR/灾备 | 必须保证连续 WAL 链 |

## 1. 逻辑备份 {/* #逻辑备份 */}

Custom/directory 格式支持 `pg_restore` 并行和选择对象。备份时记录工具版本、snapshot、扩展、roles、tablespaces；恢复顺序处理 owner/ACL/extension，并执行 ANALYZE。

## 2. 物理与归档 {/* #物理与归档 */}

Base backup 提供起点，archive_command 将完成 WAL 段安全复制到独立存储。命令需幂等、校验且同名不同内容拒绝覆盖。监控 `pg_stat_archiver`、归档延迟和 `pg_wal` 空间。

## 3. PITR {/* #pitr */}

```text
restore base backup
→ configure restore_command
→ set recovery target time/LSN/name
→ replay WAL
→ pause/verify target
→ promote → new timeline
```

先恢复到隔离网络，避免旧应用误连。按业务表计数、约束、关键事务和最大事件版本验收，不只看数据库启动。

## 4. 3-2-1 与安全 {/* #3-2-1-与安全 */}

至少三份、两种介质、一份异地/隔离；加密、不可变保留、最小权限、校验和和删除审计。Ransomware 能访问主库凭据时不应同时能删除所有备份。

## 5. 备份恢复闭环 {/* #备份恢复闭环 */}

```bash
pg_dump --format=custom --file=app.dump --dbname=app
pg_restore --list app.dump
pg_basebackup --checkpoint=fast --wal-method=stream --format=plain \
  --pgdata=/backup/base --dbname='host=db user=backup'
pg_verifybackup /backup/base
```

逻辑备份适合对象级恢复/迁移，物理 base backup + 连续 WAL 归档用于整集群 PITR。任何备份成功状态都要在隔离主机恢复：验证 PostgreSQL 大版本、tablespace、扩展、角色、配置、WAL 连续性、目标时间/timeline、行数和应用查询。

归档命令必须只在成功持久化后返回 0，并对延迟/失败/容量告警；错误地返回成功会造成不可恢复的 WAL 缺口。PITR 先恢复 base backup，再回放到明确时间/LSN/事务并创建新 timeline。不要在原数据目录直接试恢复，始终保留源备份和可回退点。

## 6. 验收题 {/* #验收题 */}

- pg_dump 与物理备份分别适合什么？
- 为什么 WAL 必须连续？
- PITR Promote 为什么产生新 Timeline？
- “备份任务成功”还缺什么证据？

## 7. 参考资料 {/* #参考资料 */}

- [Backup and restore](https://www.postgresql.org/docs/18/backup.html)
- [pg_basebackup](https://www.postgresql.org/docs/18/app-pgbasebackup.html)
