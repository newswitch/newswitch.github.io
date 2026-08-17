---
title: "Binlog Format、Position、GTID 与复制数据路径"
sidebar_label: "01. Binlog Format、Position、GTID 与复制数据路径"
sidebar_position: 1
tags: [MySQL, Binlog, GTID, Replication]
description: "从源库提交、Binlog、传输、Relay Log 到副本应用，理解格式、位置、GTID 和一致性边界。"
---

# Binlog Format、Position、GTID 与复制数据路径

Binary Log 记录服务器上的逻辑变更，是复制和时间点恢复的核心。它与 InnoDB redo 不同：redo 服务于存储引擎崩溃恢复，Binlog 服务于服务器级复制、审计式重放和 PITR。

## 1. 完整路径

```text
client transaction
→ InnoDB changes + redo/undo
→ server writes binlog event
→ coordinated commit
→ source binlog dump sender
→ replica receiver thread
→ relay log
→ coordinator/applier workers
→ replica InnoDB commit
```

“源库已提交”不等于“副本已执行”，读写分离必须定义 read-after-write 语义。

## 2. 三种格式

| 格式 | 记录 | 优势 | 风险/成本 |
|---|---|---|---|
| STATEMENT | SQL 语句 | 某些批量操作日志小 | 非确定函数、上下文和安全边界复杂 |
| ROW | 发生变化的行事件 | 复制更确定、CDC 友好 | 大事务可能产生大量日志 |
| MIXED | 按情况切换 | 折中 | 行为理解和验证更复杂 |

```sql
SHOW VARIABLES LIKE 'binlog_format';
SHOW VARIABLES LIKE 'binlog_row_image';
SHOW BINARY LOGS;
SHOW MASTER STATUS;
```

默认值和命令可用性要以目标 8.4 小版本为准。格式变化影响恢复、CDC、空间和兼容性，应先验证整个下游。

## 3. File/Position

传统复制使用：

```text
binlog file + byte position
```

配置必须与同一一致性快照对应。只拿一个 `SHOW MASTER STATUS` 结果再复制数据，若两者时刻不一致会缺失或重复事务。

## 4. GTID

GTID 为源上提交事务分配拓扑内唯一标识：

```text
source_uuid:transaction_number
```

常见集合：

```sql
SELECT @@GLOBAL.gtid_executed;
SELECT @@GLOBAL.gtid_purged;
```

GTID 让副本能够描述“已执行哪些事务”，简化自动定位和切换，但不自动保证副本数据正确，也不替代备份。绕过复制直接写副本、过滤、非事务表或错误跳过仍可能造成差异。

## 5. 提交持久性边界

关键参数共同决定断电后可能丢失的窗口：

```sql
SHOW VARIABLES WHERE Variable_name IN (
 'sync_binlog','innodb_flush_log_at_trx_commit',
 'log_bin','log_replica_updates','gtid_mode',
 'enforce_gtid_consistency'
);
```

不要只看一个参数。文件系统、设备写缓存和云盘持久性也属于链路。必须用故障注入验证，而不是从配置推断绝对零丢失。

## 6. 事务边界与大事务

一个大事务会造成：Binlog 事件大、网络突发、relay 占用、单事务应用时间长、延迟和恢复尖峰。将批任务拆成有界、幂等、可续跑的小事务，通常比只增加 worker 更有效。

## 7. 观测与检查

```sql
SHOW REPLICA STATUS\G
SELECT * FROM performance_schema.replication_connection_status\G
SELECT * FROM performance_schema.replication_applier_status_by_worker;
```

关注 receiver/applier 是否运行、最后错误、源与副本 GTID 集合、relay 空间和 worker 状态。术语和字段在不同版本会变化，监控需版本适配。

## 8. 实验

创建三笔可识别事务，使用 `mysqlbinlog` 查看事件和 GTID；暂停 receiver 与 applier 分别观察差异；恢复后验证 executed 集合、数据和延迟归零。

## 参考资料

- [Replication Formats](https://dev.mysql.com/doc/refman/8.4/en/replication-formats.html)
- [Replication with GTIDs](https://dev.mysql.com/doc/refman/8.4/en/replication-gtids.html)
- [Replication Threads](https://dev.mysql.com/doc/refman/8.4/en/replication-threads.html)

