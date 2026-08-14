---
title: "ACID、隔离级别、MVCC、版本链与 Read View"
sidebar_position: 5
tags: [MySQL, ACID, MVCC, 隔离级别, Read View]
description: "理解事务 ACID、四种隔离级别、一致性读、当前读、Undo 版本链和 Read View 的可见性规则。"
---

# ACID、隔离级别、MVCC、版本链与 Read View

MVCC 让读者在许多场景下不阻塞写者，但它不是“完全无锁”。一致性读、锁定读和写操作走不同并发路径，隔离级别决定快照建立与锁范围。

---

## 1. ACID

- **Atomicity**：事务内变化整体提交或回滚，依赖 Undo 与事务协议；
- **Consistency**：约束和业务不变量从合法状态到合法状态，数据库与应用共同负责；
- **Isolation**：并发事务的中间状态按隔离规则隐藏/控制；
- **Durability**：已确认提交在定义的故障模型下可恢复，依赖 Redo/Binlog 刷盘、存储与备份。

ACID 不是一个开关。持久性参数、非事务表、跨服务副作用和错误事务边界都会改变保证。

---

## 2. 四种隔离级别

| 级别 | 主要语义 |
| --- | --- |
| READ UNCOMMITTED | 允许看到未提交变化，实际业务很少采用 |
| READ COMMITTED | 每次一致性读通常建立新快照 |
| REPEATABLE READ | 同一事务内一致性读通常复用快照，MySQL 常见默认 |
| SERIALIZABLE | 更强并发约束，降低并发并增加阻塞风险 |

```sql
SELECT @@transaction_isolation;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
START TRANSACTION;
```

`SET TRANSACTION` 的作用范围和执行时机要核对，不在事务中途随意改变。

---

## 3. 脏读、不可重复读和幻读

```text
脏读：读到其他事务尚未提交、最终可能回滚的值
不可重复读：同一事务两次读同一行得到不同已提交值
幻读：按同一范围两次读，出现/消失满足条件的行
```

这些现象只是理解隔离的入口。真实业务还要考虑写偏斜、丢失更新、状态检查与范围约束。

---

## 4. 版本链

行更新时，当前记录包含事务标识和指向 Undo 的 Roll Pointer，旧值形成版本链：

```text
current version (trx 120)
→ older version (trx 115)
→ older version (trx 98)
```

一致性读根据 Read View 找到对当前事务可见的版本。版本链过长会增加读取和 Purge 成本。

---

## 5. Read View

Read View 概念上记录创建快照时活跃事务范围，用来判断某版本：

- 在快照前已提交，可见；
- 由当前事务产生，可见；
- 当时仍活跃或更晚产生，不可见，需要沿 Undo 找旧版本。

具体内部字段属于实现细节，学习重点是：可见性由版本创建事务与快照边界共同决定，而不是简单“取磁盘最新值”。

---

## 6. RR 与 RC 的快照差异

两个会话实验：

```text
T1 开事务并 SELECT
T2 UPDATE + COMMIT
T1 再 SELECT
```

在 RR 的普通一致性读中，T1 通常继续看到原快照；在 RC 中，第二条语句通常建立新快照并看到 T2 已提交值。

必须用目标版本、同一 SQL 和明确事务边界实验，不把 ORM 日志中的“BEGIN”当作唯一证据。

---

## 7. 一致性读与当前读

普通 `SELECT` 通常是一致性非锁定读。下面属于锁定/当前读语义：

```sql
SELECT ... FOR UPDATE;
SELECT ... FOR SHARE;
UPDATE ...;
DELETE ...;
```

它们需要基于当前可锁定版本执行业务修改，因此可能等待锁，并在 RR 下对范围使用更强锁保护。

不能用普通 SELECT 做“检查库存后扣减”的并发保护；另一个事务可能在检查和修改之间改变数据。

---

## 8. 原子条件更新

库存扣减可把检查与修改合成一条语句：

```sql
UPDATE inventory
SET available = available - 1
WHERE product_id = ?
  AND available >= 1;
```

再检查影响行数。它常比“SELECT 后 UPDATE”更短、更安全；复杂跨行规则仍需事务和锁定读。

---

## 9. 长快照的代价

长报表事务即使只读，也可能：

- 阻止 Undo Purge；
- 增大 History List；
- 使其他查询沿更长版本链；
- 增加 Undo 表空间；
- 影响 DDL/恢复窗口。

报表应评估只读副本、快照时长、分批与分析系统，而不是无限保持主库 RR 事务。

---

## 10. 隔离级别不是越高越好

更高隔离通常意味着更多锁/冲突或更低并发。选择依据：

- 业务不变量；
- 读写模式；
- 能否用唯一约束/原子更新；
- 冲突率；
- 重试能力；
- 延迟 SLO。

把隔离降到 RC 可能减少部分范围锁影响，但不能自动修复错误事务和缺失索引。

---

## 11. 观测

```sql
SELECT * FROM information_schema.innodb_trx\G
SHOW ENGINE INNODB STATUS\G
```

关注事务开始时间、状态、锁定/修改行、当前 SQL、History List。业务监控还要记录事务时长 P99 和超时/回滚率。

---

## 12. 实验与验收

使用两个会话分别在 RC/RR 重现：脏读边界、不可重复读、范围插入、普通 SELECT 与 `FOR UPDATE`、长快照和原子条件更新。

验收题：

1. ACID 四项由哪些机制共同保证？
2. RC 与 RR 的 Read View 生命周期有何主要区别？
3. 一致性读与当前读为什么表现不同？
4. 普通 SELECT 为什么不能保护“先查后改”？
5. 长只读事务为什么增加 Undo 压力？
6. 隔离级别为什么不是越高越好？

下一篇进入具体锁类型、等待链和死锁。

## 官方参考

- [InnoDB Multi-Versioning](https://dev.mysql.com/doc/refman/8.4/en/innodb-multi-versioning.html)
- [Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)
