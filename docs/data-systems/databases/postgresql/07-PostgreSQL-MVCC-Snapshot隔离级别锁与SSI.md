---
title: "MVCC、Snapshot、隔离级别、锁与 SSI"
sidebar_position: 7
tags: [PostgreSQL, MVCC, Isolation, Lock, SSI]
description: "理解行版本可见性、Read Committed、Repeatable Read、Serializable、阻塞和死锁。"
---

# MVCC、Snapshot、隔离级别、锁与 SSI

MVCC 让读者按 Snapshot 选择行版本，减少普通读写互斥，但更新同一行、DDL、外键和显式锁仍会等待。

## 隔离级别

| 级别 | Snapshot | 主要边界 |
| --- | --- | --- |
| Read Committed | 每条语句新快照 | 同事务两次读可变化 |
| Repeatable Read | 事务快照 | PostgreSQL 防止更多异常，仍可能序列化失败 |
| Serializable | SSI | 监测读写依赖并回滚危险结构 |

Serializable 不是把所有事务排队，而是 Serializable Snapshot Isolation；应用必须捕获 `serialization_failure` 并重试整个事务。

## 锁和等待链

行锁、表锁、advisory lock 和 predicate lock 含义不同。排障联结 `pg_stat_activity`、`pg_locks`、`pg_blocking_pids()`：

```text
waiter → requested lock/wait_event
→ blocker → transaction age/query/application
→ root blocker
```

`idle in transaction` 会长期持快照/锁，应设置应用事务边界和超时。死锁由数据库检测并终止一个事务，不能只调大 deadlock timeout。

## 正确并发模式

- 用 UNIQUE/约束保护不变量；
- `SELECT ... FOR UPDATE [SKIP LOCKED]` 明确任务领取语义；
- 更新使用业务版本进行乐观并发；
- 事务内不调用慢外部服务；
- 重试要幂等、有限、带抖动。

## 验收题

- MVCC 为什么不能消灭写写锁？
- Read Committed 的两条 SELECT 为何可见不同数据？
- SSI 为什么会主动回滚事务？
- 如何找到根阻塞者而非误杀等待者？

## 参考资料

- [MVCC](https://www.postgresql.org/docs/18/mvcc.html)
- [Explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)
