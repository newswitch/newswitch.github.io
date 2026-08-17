---
title: "管理 SQL、Performance Schema 与故障实验手册"
sidebar_position: 5
tags: [MySQL, 管理SQL, Performance Schema, 故障实验]
description: "提供只读优先的实例、会话、事务、锁、复制、空间和性能诊断 SQL，并设计可控故障实验。"
---

# 管理 SQL、Performance Schema 与故障实验手册

本文命令分为只读诊断、可变更操作和故障实验。生产默认只执行只读部分；任何 `KILL`、复制控制、参数或 DDL 都要走 Runbook。

## 1. 环境指纹

```sql
SELECT @@hostname, @@port, @@version, @@version_comment,
       @@server_uuid, @@server_id, @@read_only, @@super_read_only,
       @@gtid_mode, @@binlog_format;

SELECT NOW(6), @@system_time_zone, @@session.time_zone,
       @@transaction_isolation, @@autocommit;
```

先确认“在哪台、什么角色、什么版本”，再操作。

## 2. 配置和值来源

```sql
SHOW VARIABLES LIKE 'innodb%';

SELECT VARIABLE_NAME, VARIABLE_SOURCE, VARIABLE_PATH,
       MIN_VALUE, MAX_VALUE, SET_TIME, SET_USER, SET_HOST
FROM performance_schema.variables_info
WHERE VARIABLE_NAME = 'max_connections';
```

动态改动示意仅供受控变更：

```sql
SET GLOBAL max_connections = ...;
SET PERSIST max_connections = ...;
RESET PERSIST max_connections;
```

必须保存旧值并确认对现有/新会话的作用。

## 3. 会话与语句

```sql
SHOW FULL PROCESSLIST;

SELECT PROCESSLIST_ID, PROCESSLIST_USER, PROCESSLIST_HOST,
       PROCESSLIST_DB, PROCESSLIST_TIME, PROCESSLIST_STATE,
       PROCESSLIST_INFO
FROM performance_schema.threads
WHERE TYPE='FOREGROUND'
ORDER BY PROCESSLIST_TIME DESC;
```

完整 SQL 可能含敏感参数。终止前确认线程映射、事务和回滚量：

```sql
KILL QUERY <id>;
KILL CONNECTION <id>;
```

不要批量拼接执行未知目标。

## 4. 事务、锁和 MDL

```sql
SELECT * FROM information_schema.innodb_trx
ORDER BY trx_started;

SELECT * FROM performance_schema.data_lock_waits;
SELECT * FROM performance_schema.data_locks;

SELECT OBJECT_TYPE, OBJECT_SCHEMA, OBJECT_NAME,
       LOCK_TYPE, LOCK_DURATION, LOCK_STATUS, OWNER_THREAD_ID
FROM performance_schema.metadata_locks
WHERE LOCK_STATUS <> 'GRANTED';
```

沿等待图找到根阻塞者，再关联 thread/process 和业务。等待者慢不等于应杀等待者。

## 5. Top Digest

```sql
SELECT SCHEMA_NAME, DIGEST, DIGEST_TEXT, COUNT_STAR,
       ROUND(SUM_TIMER_WAIT/1e12,2) total_s,
       ROUND(AVG_TIMER_WAIT/1e9,2) avg_ms,
       SUM_ROWS_EXAMINED, SUM_ROWS_SENT,
       SUM_LOCK_TIME, SUM_CREATED_TMP_DISK_TABLES,
       FIRST_SEEN, LAST_SEEN
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 30;
```

分别换排序列寻找平均慢、扫描大、锁大和临时表多的 SQL。摘要是累计值，应按时间窗口采集。

## 6. InnoDB 与空间

```sql
SHOW ENGINE INNODB STATUS\G

SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE,
       DATA_LENGTH, INDEX_LENGTH, DATA_FREE, TABLE_ROWS
FROM information_schema.TABLES
WHERE ENGINE='InnoDB'
ORDER BY DATA_LENGTH + INDEX_LENGTH DESC
LIMIT 30;

SHOW GLOBAL STATUS WHERE Variable_name IN (
 'Innodb_buffer_pool_reads','Innodb_buffer_pool_read_requests',
 'Innodb_buffer_pool_pages_dirty','Innodb_data_fsyncs',
 'Innodb_os_log_written','Innodb_row_lock_time'
);
```

`SHOW ENGINE` 是时点文本且部分区段重置/覆盖，事故时及时保存。

## 7. 索引与统计

```sql
SHOW CREATE TABLE app.orders\G
SHOW INDEX FROM app.orders;
ANALYZE TABLE app.orders;

SELECT * FROM sys.schema_unused_indexes
WHERE object_schema='app';
```

`ANALYZE` 是变更操作，可能改变计划；unused 统计自实例/P_S 重置以来有效，不能据此直接删除索引。

## 8. 复制

```sql
SHOW REPLICA STATUS\G
SELECT * FROM performance_schema.replication_connection_status\G
SELECT * FROM performance_schema.replication_applier_status_by_worker;
SELECT @@GLOBAL.gtid_executed, @@GLOBAL.gtid_purged;
```

控制语句：`STOP REPLICA`、`START REPLICA`、`RESET REPLICA` 等具有不同破坏性；尤其 RESET 会改变元数据，必须按官方文档和恢复计划使用。

## 9. 账户权限

```sql
SELECT USER, HOST, ACCOUNT_LOCKED, PASSWORD_EXPIRED
FROM mysql.user;
SHOW GRANTS FOR 'app'@'10.%';
SELECT * FROM information_schema.ENABLED_ROLES;
```

查询 `mysql.*` 也需要受限，输出不可进入公共日志。

## 10. 故障实验规则

只在隔离环境：独立实例/命名空间、虚构数据、备份、资源上限、停止条件、观察面和清理步骤。禁止连接生产凭据和网络。

### 行锁等待

会话 A 开事务更新一行不提交；会话 B 更新同一行。观察 `data_lock_waits` 后回滚 A，验证队列消失。

### MDL 阻塞

会话 A 开事务读取表并保持；会话 B 执行受控 ALTER。观察 `metadata_locks`，随后取消 DDL、回滚 A。

### 死锁

两个会话以相反顺序更新两行，观察死锁受害者和 `SHOW ENGINE INNODB STATUS`。应用应重试完整事务。

### 复制延迟

实验拓扑暂停 applier，生成小事务，观察 received/executed/relay；恢复并测 catch-up。不要制造无界 backlog。

### 磁盘/CPU/网络

使用实验平台的受控故障注入，设置持续时间和自动撤销；观察 MySQL 与 OS 指纹。不要直接填满生产盘或修改主机全局网络。

## 11. 实验记录模板

```text
假设与预期指纹
环境与版本
注入步骤/持续时间
业务、MySQL、OS 指标
告警与 Runbook 表现
恢复步骤和用时
数据校验
偏差与改进
```

## 参考资料

- [Performance Schema Table Reference](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-table-reference.html)
- [Replication SQL Statements](https://dev.mysql.com/doc/refman/8.4/en/replication-statements.html)
- [InnoDB Standard Monitor](https://dev.mysql.com/doc/refman/8.4/en/innodb-standard-monitor.html)
