---
title: "Redo、Undo、Binlog 与一次提交的完整路径"
sidebar_position: 4
tags: [MySQL, Redo, Undo, Binlog, 事务提交]
description: "区分 Redo、Undo 和 Binlog，追踪 InnoDB 事务从修改、两阶段提交到持久化、复制与恢复的完整路径。"
---

# Redo、Undo、Binlog 与一次提交的完整路径

三个日志回答不同问题：崩溃后怎样恢复 Page、事务怎样回滚/构造旧版本、变更怎样复制和做 PITR。把它们都称为“事务日志”会掩盖关键差异。

---

## 1. 职责表

| 日志 | 层次 | 记录视角 | 主要消费者 |
| --- | --- | --- | --- |
| Redo | InnoDB | 页修改的恢复信息 | Crash Recovery |
| Undo | InnoDB | 修改前版本/回滚信息 | Rollback、MVCC、Purge |
| Binlog | Server | 事务逻辑事件 | Replica、PITR、CDC |

Redo 循环复用；Binlog 按文件保留策略管理；Undo 在不再被事务/快照需要后清理。

---

## 2. Redo：Write-Ahead Logging

原则：相关数据页写回前，能重建该修改的 Redo 必须先安全写入日志。

```text
修改 Buffer Pool Page
→ Redo 写入 Log Buffer
→ 写入/刷入 Redo 文件
→ 数据页以后刷盘
```

因此提交不需要随机写回所有业务页，把同步持久化集中到顺序日志路径。

Redo 使用 LSN 标识日志位置。Checkpoint 表示此前修改已反映到数据文件，可推进可复用边界。

---

## 3. Undo：回滚与历史版本

更新前生成 Undo，使事务可以反向恢复，并让一致性读沿版本链找到可见旧版本。

```text
current row
→ roll pointer
→ older version
→ older version ...
```

提交后 Undo 不一定立即删除；只要活跃 Read View 可能需要它就要保留。长事务会扩大 History List 和 Undo 空间。

---

## 4. Binlog：复制与恢复时间线

Binlog 记录已提交事务的变更事件，可用于：

- Source→Replica；
- 基于时间点恢复；
- CDC；
- 审计/回放边界（需控制权限和隐私）。

Binlog 格式、GTID、保留期和完整备份共同决定可恢复窗口。只有 Binlog、没有基础备份，无法高效从任意历史起点恢复整个实例。

---

## 5. 一次 UPDATE

```sql
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;
```

概念路径：

```text
定位聚簇记录并加锁
→ 写 Undo
→ 修改内存 Page
→ 生成 Redo
→ Server 生成 Binlog Cache/Event
→ Prepare/Commit 协调
→ 按配置写入并刷日志
→ 返回 Commit 成功
→ 脏页以后刷回表空间
→ Undo 以后 Purge
```

实际内部细节会随版本演进，稳定要点是协调 Redo 与 Binlog，避免一边认为提交、另一边缺失事务。

---

## 6. 两阶段提交心智模型

MySQL 需要让 InnoDB 提交状态与 Binlog 一致：

```text
InnoDB Prepare
→ Binlog 写入/提交
→ InnoDB Commit
```

若中间崩溃，恢复根据日志状态判断事务应提交还是回滚。它不是跨任意微服务的分布式事务协议，而是 Server 与存储引擎内部提交协调。

---

## 7. 刷盘参数与数据丢失窗口

提交延迟与持久性受 Redo/Binlog 写入刷盘配置、OS 与存储语义共同影响。

调低同步刷盘频率可能提高吞吐，但在 OS/主机故障时丢失最近已向客户端确认的事务。必须写入 RPO、故障模型并做断电级测试，不能只看 mysqld 进程重启。

查询目标实例：

```sql
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit';
SHOW VARIABLES LIKE 'sync_binlog';
SHOW VARIABLES LIKE 'binlog_format';
SHOW VARIABLES LIKE 'innodb_redo_log_capacity';
```

不要把示例值当推荐值。

---

## 8. Group Commit

多个并发事务可在日志写入/刷盘阶段合并固定成本，提高吞吐。单并发延迟、并发吞吐和存储 fsync 能力相互作用。

压测要记录：

- Commit/s 与延迟分位数；
- 并发；
- Redo/Binlog Bytes/s；
- fsync 延迟；
- Replica/CDC 消费；
- 持久性配置。

---

## 9. 大事务

大事务放大：

- Undo/Redo/Binlog；
- 锁持有；
- Replica 回放与 Lag；
- CDC 单事务延迟；
- 回滚和 Crash Recovery；
- 备份与网络峰值。

批量任务按业务原子性合理分批，使用幂等断点。不能为了性能随意拆开必须原子完成的账务事务。

---

## 10. 日志保留与磁盘满

Binlog 保留过短会破坏 PITR 和延迟 Replica 恢复；过长会占满磁盘。Redo 容量影响 Checkpoint 压力，Undo 受长事务/Purge 影响。

分别监控：

```text
Redo capacity/usage/rate
Checkpoint age
Undo tablespace/history
Binlog current size/growth/retention
filesystem free and inode
backup restore point coverage
```

磁盘告警必须预留应急和恢复时间，不在 99.9% 才处理。

---

## 11. 复制不是备份

误删事务会进入 Binlog 并复制到 Replica；逻辑错误不会被副本自动阻止。备份提供独立时间点和保留，Binlog 提供增量恢复，两者共同满足 RPO/RTO。

---

## 12. 实验

1. 小事务与大事务比较 Redo/Binlog 增长和提交延迟；
2. 开长事务更新但不提交，观察 Undo/锁；
3. Commit 与 Rollback 比较最终数据和日志现象；
4. 在隔离环境模拟异常退出，观察恢复；
5. 使用备份 + Binlog 恢复到指定事务前；
6. 改变持久性参数仅做故障实验，明确丢失边界并恢复安全值。

## 13. 验收题

1. Redo、Undo、Binlog 分别解决什么？
2. WAL 为什么允许数据页延迟刷盘？
3. 提交后 Undo 为什么可能继续保留？
4. 内部两阶段提交协调哪两个状态？
5. 为什么降低刷盘频率会改变 RPO？
6. 大事务如何影响复制与恢复？
7. 为什么 Binlog 不能单独替代完整备份？

下一篇进入并发可见性：ACID、隔离级别、MVCC 与 Read View。

## 官方参考

- [InnoDB Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)
- [InnoDB Undo Logs](https://dev.mysql.com/doc/refman/8.4/en/innodb-undo-logs.html)
- [Binary Log](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)
- [InnoDB and the ACID Model](https://dev.mysql.com/doc/refman/8.4/en/mysql-acid.html)
