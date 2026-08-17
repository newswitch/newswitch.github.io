---
title: "Performance Schema、sys Schema 与关键状态指标"
sidebar_position: 2
tags: [MySQL, Performance Schema, sys Schema, 可观测性]
description: "从累计状态到事件、等待、摘要和 sys 视图，建立低基数、可归因的 MySQL 观测方法。"
---

# Performance Schema、sys Schema 与关键状态指标

`SHOW STATUS` 告诉你“发生了多少”，Performance Schema 更接近“谁在何时因什么消耗或等待”，sys Schema 则提供便于阅读的汇总视图。

## 1. 四层观测模型

```text
业务 SLI：成功率、延迟、正确性
SQL：digest、调用、扫描、锁、临时表
引擎：Buffer Pool、redo、事务、复制
OS：CPU、内存、磁盘、网络
```

只看任一层都会误判。例如 CPU 低并不代表健康，可能所有会话都在等行锁。

## 2. Status 必须看速率

```sql
SHOW GLOBAL STATUS LIKE 'Questions';
SHOW GLOBAL STATUS LIKE 'Threads_running';
SHOW GLOBAL STATUS LIKE 'Created_tmp_disk_tables';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_reads';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read_requests';
```

大部分值是实例启动以来累计量。用两个时间点差值除以间隔得到每秒速率；`Threads_running` 等是瞬时量，应观察分位和趋势。

缓存命中不能只报告一个长期百分比。故障窗口的物理读速率、磁盘延迟和工作集变化更重要。

## 3. Performance Schema 结构

核心对象：

```text
setup_instruments：哪些事件可被采集
setup_consumers：事件流向哪些表
events_*_current/history：事件样本
summary_*：按线程、账户、对象、digest 等汇总
data_locks/data_lock_waits：锁与等待关系
memory_summary_*：内存归属
replication_*：复制状态
```

先查看配置，不要在故障时无评估地打开所有详细 history：

```sql
SELECT * FROM performance_schema.setup_consumers;
SELECT NAME, ENABLED, TIMED
FROM performance_schema.setup_instruments
WHERE NAME LIKE 'wait/io/file/innodb/%';
```

采集有成本，按问题启用最小所需范围，并记录恢复动作。

## 4. 用 Digest 找 Top SQL

```sql
SELECT SCHEMA_NAME, DIGEST_TEXT, COUNT_STAR,
       ROUND(SUM_TIMER_WAIT/1e12,2) total_s,
       SUM_ROWS_EXAMINED, SUM_ROWS_SENT,
       SUM_LOCK_TIME,
       SUM_CREATED_TMP_DISK_TABLES
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

分别按总耗时、平均耗时、扫描行、锁时间和磁盘临时表排序。高频 10 ms SQL 可能比偶发 2 s SQL 更值得先优化。

摘要会归一化参数，表有容量上限且数据可能被清空。生产应由监控系统周期采集，而不是把内存表当长期审计库。

## 5. 锁等待图

```sql
SELECT * FROM performance_schema.data_lock_waits;
SELECT * FROM performance_schema.data_locks;
SELECT * FROM information_schema.innodb_trx;
```

排查顺序：等待者 → 阻塞者 → 阻塞事务开始时间 → SQL/应用 → 是否可安全结束。终止连接可能触发回滚，不能只杀队列最前面的线程。

sys Schema 提供更易读入口：

```sql
SELECT * FROM sys.innodb_lock_waits;
SELECT * FROM sys.session ORDER BY time DESC;
```

## 6. I/O 与热点对象

```sql
SELECT * FROM sys.io_global_by_file_by_bytes LIMIT 20;
SELECT * FROM sys.schema_table_statistics_with_buffer
ORDER BY io_read DESC LIMIT 20;
SELECT * FROM sys.schema_index_statistics
ORDER BY rows_selected DESC LIMIT 20;
```

这些视图帮助回答哪张表、哪个索引或文件产生工作，但仍需与 OS 块设备延迟和真实业务时间窗关联。

## 7. 关键指标最小集

| 领域 | 指标 |
|---|---|
| 流量 | QPS/TPS、连接、新建连接 |
| 延迟 | API 与 SQL P50/P95/P99 |
| 并发 | Threads_running、事务数、锁等待 |
| 读写 | rows examined/sent/changed |
| 缓存 | Buffer Pool 数据/脏页、物理读 |
| 日志 | redo 生成、checkpoint age、fsync |
| 临时 | 内存/磁盘临时表、sort rows |
| 复制 | receiver/applier、GTID gap、lag |
| 错误 | aborted、deadlock、timeout、readonly |

避免把表名、SQL 原文、用户 ID 等高基数或敏感值直接作为时序标签。

## 8. 快照与基线

事故前要有：相同星期/时段基线、变更标记、实例重启时间和容量水位。事故中记录时间线，不要为了“重新计数”提前 truncate Performance Schema 摘要而销毁证据。

## 9. 实验

分别制造一次全表扫描、行锁等待、磁盘临时表和高频点查，使用 digest、sys 视图和 OS 指标定位。验收是能从业务告警追到具体 SQL 和资源，而不是记住表名。

## 参考资料

- [MySQL Performance Schema](https://dev.mysql.com/doc/refman/8.4/en/performance-schema.html)
- [sys Schema](https://dev.mysql.com/doc/refman/8.4/en/sys-schema.html)
- [Statement Summary Tables](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-summary-tables.html)

