---
title: "PostgreSQL 锁竞争与在线结构演进"
sidebar_label: "06. PostgreSQL 锁竞争与在线结构演进"
sidebar_position: 6
description: "用双会话理解丢失更新、条件更新、锁等待、死锁与事务重试，再演进已有数据的表结构。"
tags: [FastAPI, PostgreSQL, 事务, Alembic]
---

# PostgreSQL 锁竞争与在线结构演进

SQLite 示例能够解释事务边界，不能替代服务端数据库的并发实验。这里使用 PostgreSQL 18 的两个交互会话，观察数据库何时阻塞、何时拒绝，以及应用应该重做哪一段工作。

## 1. 建立可丢弃的实验数据

只在独立学习数据库执行。以下 schema 不存在时才创建；若已存在，先确认是否属于自己，不改成自动覆盖：

```sql
CREATE SCHEMA task_lock_lab;
CREATE TABLE task_lock_lab.account (
  id integer PRIMARY KEY,
  balance integer NOT NULL,
  revision integer NOT NULL DEFAULT 0
);
INSERT INTO task_lock_lab.account(id, balance) VALUES (1, 100), (2, 100);
```

打开两个连接到同一实验库的 psql 终端，分别称 A、B。每次实验结束确认 COMMIT/ROLLBACK，不让上一次未结束事务影响下一次判断。

## 2. 重现先查后写的丢失更新

A 开始事务，读取 id=1 的 balance=100。B 也读取 100，将“加十”计算结果 110 写入并提交；A 之后将自己根据旧值计算出的 110 写入并提交。最终是 110，不是期望的 120。

问题在于应用把读取与计算后的常量写回，没有让数据库知道计算依赖旧版本。可改为：

```sql
UPDATE task_lock_lab.account
SET balance = balance + 10, revision = revision + 1
WHERE id = 1 AND revision = 0
RETURNING balance, revision;
```

返回零行表示预期版本已过期，不能仍向客户端返回成功。对于累加操作，数据库内表达式能避免部分丢失更新；若业务还包含余额检查、外部付款等多项条件，仍要设计完整事务与一致性边界。

## 3. 观察真正的锁等待

A 执行并保持事务不提交：

```sql
BEGIN;
SELECT * FROM task_lock_lab.account WHERE id = 1 FOR UPDATE;
```

B 使用有限等待：

```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
UPDATE task_lock_lab.account SET balance = balance + 1 WHERE id = 1;
```

B 会等待同一行的冲突锁，超过预算后报锁超时，而不是因为 Python 事件循环“没有 await”。出错后先 ROLLBACK；A 也结束事务。第三个观察连接可查询 pg_stat_activity、wait_event_type、pg_blocking_pids(pid) 和 pg_locks，关联等待者与持有者。查看其他用户详情受权限限制。

锁时间取决于事务，不取决于某条 SELECT 已经返回。把慢 HTTP 放在 A 的事务里，会让 B 一直等远端服务，应用连接池也可能随之耗尽。

## 4. 死锁与重试范围

A 锁住行 1，B 锁住行 2，再让 A 更新行 2、B 更新行 1，形成循环等待。数据库检测后会中止其中一个事务；被中止者必须回滚。按稳定顺序锁定行 1、再行 2，可以消除这一种环路，但不代表所有业务都永远没有死锁。

可重试的序列化失败和死锁通常分别涉及 SQLSTATE 40001、40P01。重试的是有界的完整事务：重新读取、重新判断、重新写入；不是在失败 Session 上只重发最后一条 SQL。连接中断或提交响应丢失还可能导致提交结果未知，应利用幂等键查询，不无条件重复外部副作用。

任务领取使用 FOR UPDATE SKIP LOCKED，可以跳过已被其他 Worker 锁住的候选行；它适合队列领取，不是获得完整一致查询结果的通用技巧。领取后立即提交，真正执行时不继续持有那把行锁。

## 5. 已有数据怎样增加必填字段

假设 account 需要新增 currency。直接增加非空列可能遇到旧数据、锁和旧程序兼容问题，应拆成可解释的技术阶段：

1. 扩展：添加可空 currency，先让新程序能处理空值，旧程序仍能运行。
2. 写入兼容：明确旧写入者如何填值，可采用符合业务的默认值或兼容逻辑，不能只依赖新程序。
3. 分批回填：按主键范围更新历史行，每批独立提交，记录进度并可重复执行。
4. 验证：检查空值、币种含义以及新旧读写是否一致，再实施约束。
5. 收缩：确认所有旧版本和消费者退出后，才移除兼容路径或旧列。

PostgreSQL 可先建立 CHECK 约束并使用 NOT VALID，随后 VALIDATE；具体锁与扫描成本需要在目标版本验证。CREATE INDEX CONCURRENTLY 不能放进普通事务块，失败可能留下无效索引；迁移工具要明确事务配置并检查索引状态。

Alembic autogenerate 主要比较结构，不知道币种的业务含义，也不会自动决定回填节奏。downgrade 删除列不是数据恢复方案，应用回退与数据恢复必须分别考虑。

## 6. 练习与答案

### 6.1 B 锁超时后马上再发 UPDATE，为什么仍可能失败？

答案：当前事务可能已经处于失败状态，必须回滚并重新建立正确的事务范围；原来的锁持有者也可能尚未退出。增加重试次数不能代替定位持有者。

### 6.2 所有 Worker 领取时都加行锁，工作执行期间也要持有吗？

答案：通常不应。短事务领取并写入租约，提交后执行；靠租约与提交条件防止旧执行者写回，避免长计算占住连接和行锁。

### 6.3 回填完成后立刻加非空约束就一定安全吗？

答案：不一定。仍运行的旧写入者可能继续产生空值。应先保证兼容写入，验证约束与锁影响，再收紧结构。

## 7. 参考资料

- [PostgreSQL 显式锁与死锁](https://www.postgresql.org/docs/18/explicit-locking.html)
- [事务重试](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html)
- [ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)
- [Alembic 自动生成限制](https://alembic.sqlalchemy.org/en/latest/autogenerate.html)
