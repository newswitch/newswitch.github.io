---
title: "行锁、间隙锁、Next-Key Lock、MDL 与死锁"
sidebar_position: 6
tags: [MySQL, 行锁, 间隙锁, Next-Key Lock, 死锁]
description: "从索引记录和范围理解 InnoDB 锁，使用 Performance Schema 建立等待图并正确处理死锁。"
---

# 行锁、间隙锁、Next-Key Lock、MDL 与死锁

数据库“卡住”时，CPU 和磁盘可能都不高，因为事务在等待锁。排查必须回答：谁持有什么锁、谁在等、锁住的是记录还是范围、最前面的阻塞者是谁。

---

## 1. 锁作用在索引上

InnoDB 行锁实际锁定索引记录/范围。没有合适索引的更新可能扫描并锁定远大于预期的范围。

```sql
UPDATE orders SET status=2 WHERE customer_id=1001;
```

是否高效、锁多少，取决于索引、隔离级别、执行计划和匹配数据。

---

## 2. 常见锁

| 锁 | 含义 |
| --- | --- |
| Record Lock | 锁索引记录 |
| Gap Lock | 锁索引记录之间的间隙，限制插入 |
| Next-Key Lock | Record + 前方 Gap 的组合范围 |
| Insert Intention | 多个插入者对 Gap 的意向协调 |
| Intention Lock | 表级表明事务准备持有行级 S/X 锁 |
| AUTO-INC Lock | 自增分配相关并发控制 |
| MDL | 保护表定义，与 InnoDB 行锁不同 |

范围锁行为受隔离级别、唯一索引精确查找和语句类型影响，不用一句“RR 一定锁全范围”替代实验。

---

## 3. 锁定读

```sql
SELECT ... FOR SHARE;
SELECT ... FOR UPDATE;
```

锁在事务结束前持有。使用要求：

- 事务尽量短；
- 条件有合适索引；
- 所有代码路径以一致顺序锁对象；
- 异常确保回滚；
- 不在持锁期间调用外部服务。

---

## 4. 锁等待链

```text
T1 持有 A，正在等待外部调用
T2 等待 A，同时持有 B
T3 等待 B
→ 大量业务排队
```

真正根因是 T1，不是等待时间最长或 SQL 数量最多的 T3。

Performance Schema 入口：

```sql
SELECT * FROM performance_schema.data_locks\G
SELECT * FROM performance_schema.data_lock_waits\G
SELECT * FROM performance_schema.metadata_locks\G
```

再关联 `threads`、`events_statements_current` 和 `innodb_trx` 构建阻塞图。

---

## 5. 锁等待超时

Lock Wait Timeout 表示等待超过预算，事务/语句如何处理还取决于错误和配置。应用必须识别错误、回滚到明确状态，并按幂等规则决定是否重试。

单纯增大超时只会让队列堆得更久；降低超时也可能把正常短竞争变成错误。先优化事务、索引和并发热点。

---

## 6. 死锁

典型：

```text
T1 锁 account 1 → 等 account 2
T2 锁 account 2 → 等 account 1
```

形成环后没有事务能自行推进。InnoDB 通常检测并选择一个 Victim 回滚，使另一个继续。

死锁是并发数据库中需要正确处理的正常异常，但频繁死锁说明事务顺序、范围或索引需要优化。

---

## 7. 读取死锁证据

```sql
SHOW ENGINE INNODB STATUS\G
```

查看最近死锁中的：

- 两个事务及线程；
- 已持有和等待的索引锁；
- SQL；
- 被选 Victim；
- 涉及索引与记录范围。

若需记录所有死锁，可评估 `innodb_print_all_deadlocks`，同时治理日志量和敏感 SQL。

仅保存“Deadlock found”错误不够。

---

## 8. 减少死锁

- 多表/多行以统一顺序访问；
- 缩短事务；
- 使用精确索引减少扫描与锁范围；
- 大批处理分批；
- 避免事务内远程调用；
- 热点计数用原子更新/队列/分片；
- 失败后有限退避，重试整个事务。

降低隔离级别可能改变部分范围锁，但死锁依然可能发生。

---

## 9. MDL 不是行锁

普通 DML 也持有 MDL，DDL 需要不兼容锁。一个长事务可阻止 DDL，等待中的 DDL又可让后续查询排队。

排障同时查：

```text
data_locks/data_lock_waits
metadata_locks
innodb_trx
threads/statements
```

不要只看其中一张表。

---

## 10. Kill 的风险

终止大事务后会回滚，回滚本身可能持续很久并产生资源压力。执行前确认：

- 实例/Thread/事务 ID；
- 业务所有者；
- 修改行数与 Undo；
- 是否 DDL/复制/备份；
- N-1 和流量影响；
- 回滚观测与恢复计划。

先用可逆方式停止新流量，再处理根阻塞者。

---

## 11. 实验与验收

实验实例中重现：两会话行锁等待、范围查询阻止插入、相反顺序转账死锁、长事务阻塞 DDL，并用 Performance Schema 画等待图。

验收题：

1. InnoDB 行锁为什么与索引设计有关？
2. Record、Gap、Next-Key Lock 有什么区别？
3. 怎样找到等待链的根阻塞者？
4. 死锁与普通锁等待有何不同？
5. 为什么死锁重试必须重放整个事务？
6. Kill 大事务为何可能继续造成高负载？
7. MDL 和数据锁为何必须同时排查？

下一篇进入异常退出后的 Checkpoint 与 Crash Recovery。

## 官方参考

- [InnoDB Locking](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html)
- [Locks Set by Statements](https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html)
- [Deadlocks](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks.html)
- [Performance Schema Lock Tables](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-lock-tables.html)
