---
title: "MVCC、Snapshot、隔离级别、锁与 SSI"
sidebar_label: "07. MVCC、Snapshot、隔离级别、锁与 SSI"
sidebar_position: 7
description: "理解行版本可见性、Read Committed、Repeatable Read、Serializable、阻塞和死锁。"
tags: [PostgreSQL, MVCC, Isolation, Lock, SSI]
---

# MVCC、Snapshot、隔离级别、锁与 SSI

> 版本基线：PostgreSQL 18；最后核验：2026-08-18。监控视图和字段在旧主版本中可能不同。

MVCC 通过保留多个 Tuple 版本，让查询按 Snapshot 判断“哪个版本对我可见”。它减少普通读写之间的互斥，但不消除写写冲突、DDL 锁、外键检查、显式行锁和序列化异常。

## 1. 一次 UPDATE 不是原地覆盖

简化理解：

```text
old tuple: xmin=100, xmax=120
new tuple: xmin=120, xmax=0
```

事务 120 更新一行时，旧 Tuple 被标记为不再对后续快照可见，并创建新 Tuple。不同 Snapshot 可能同时看到不同版本。

常见系统字段：

| 字段 | 含义 | 注意 |
| --- | --- | --- |
| `xmin` | 创建该 Tuple 版本的事务 ID | 不是业务版本号 |
| `xmax` | 删除/替换或锁定相关信息 | 语义受状态位影响，不能只看数值 |
| `ctid` | 当前物理 Tuple 位置 | UPDATE/VACUUM 后可能变化 |
| `tableoid` | Tuple 所属表 | 分区/继承排查时有用 |

不能把 `xmin` 或 `ctid` 作为长期业务主键。事务 ID 会回卷，物理位置也会变化。

## 2. Snapshot 里有什么

Snapshot 的目标是判断事务和 Tuple 的可见性。概念上它需要知道：

- 获取快照时已经完成的事务；
- 当时仍在运行的事务；
- 事务 ID 的可见边界；
- 当前事务自己已经完成的命令。

可见性不是简单比较 `xmin < current_xid`。还必须判断创建事务是否提交、是否仍活跃、删除事务是否生效以及当前命令 ID。

长事务会长期保留旧 Snapshot，使旧 Tuple 不能被正常回收，最终造成 Bloat 和事务 ID Freeze 压力。因此“没有锁等待”不等于长事务无害。

## 3. 隔离级别

PostgreSQL 把 Read Uncommitted 按 Read Committed 实现。常用级别：

| 级别 | Snapshot 范围 | 允许或可能出现的现象 |
| --- | --- | --- |
| Read Committed | 每条语句获取新 Snapshot | 不可重复读、幻读、业务写偏差 |
| Repeatable Read | 通常从事务第一次实际查询开始使用事务级 Snapshot | 看不到事务开始后的提交；仍需处理并发更新失败和序列化异常语义 |
| Serializable | Snapshot Isolation + SSI 冲突检测 | 通过回滚危险事务保证可序列化结果 |

隔离级别越高，不代表所有请求都只是“更慢一点”。应用必须能够重试整个事务，否则 Serializable 返回的 `serialization_failure` 会直接变成业务错误。

## 4. Read Committed：每条语句看到新的世界

```sql
BEGIN;
SELECT balance FROM account WHERE id = 1; -- 100
-- 另一个事务提交 balance=80
SELECT balance FROM account WHERE id = 1; -- 80
COMMIT;
```

两条 SELECT 位于同一个事务，也可能看到不同结果。它适合大量常规 OLTP，但跨多条语句的不变量必须依赖锁、约束、原子 SQL 或更高隔离级别。

危险的应用层读改写：

```text
A read balance=100
B read balance=100
A write balance=80
B write balance=70
```

如果两个客户端把计算结果直接覆盖，可能丢失更新。优先使用：

```sql
UPDATE account
SET balance = balance - 20
WHERE id = 1
  AND balance >= 20
RETURNING balance;
```

把条件检查和更新放入同一条 SQL。

## 5. Repeatable Read：稳定快照不等于没有冲突

Repeatable Read 中，同一事务的查询通常看到同一份事务快照：

```text
transaction A snapshot: accounts at T1
transaction B commits at T2
transaction A: still reads T1 view
```

PostgreSQL 的 Repeatable Read 基于 Snapshot Isolation，能防止标准定义中的不可重复读和幻读，但跨多行不变量仍可能出现写偏差。

示例：两名医生至少一人值班。事务 A 和 B 都看到两人值班，各自只把自己改为休息，最终可能无人值班。单行锁不能自动保护“至少一行满足条件”这种跨行谓词。

处理方式：

- 用可表达的数据库约束；
- 锁定代表不变量的共同父行；
- 使用 Serializable 并重试；
- 把决策收敛到单条原子语句或串行队列。

## 6. Serializable 与 SSI

PostgreSQL Serializable 使用 Serializable Snapshot Isolation。它不是给每次 SELECT 都加互斥锁，而是跟踪读写依赖，识别可能形成不可序列化结果的危险结构，并中止其中一个事务。

```text
T1 reads data later written by T2
T2 reads data later written by T3
...
dependency cycle risk
→ abort one transaction
```

Predicate Lock 主要用于 SSI 冲突跟踪，不等同于普通阻塞锁。它可能显示在 `pg_locks` 中，但通常不会像行级 `FOR UPDATE` 那样直接阻塞写者。

应用重试规则：

1. 捕获 SQLSTATE `40001`；
2. 回滚整个事务；
3. 使用同一业务幂等键重新开始；
4. 有界重试并增加抖动；
5. 持续失败时返回可识别错误，而不是无限循环。

只重试最后一条 SQL 是错误的，因为新事务必须重新读取完整决策条件。

## 7. 行锁模式

常用显式行锁：

| 模式 | 常见用途 | 主要边界 |
| --- | --- | --- |
| `FOR UPDATE` | 即将修改/删除目标行 | 与其他修改和多数行锁冲突 |
| `FOR NO KEY UPDATE` | 修改非 Key 字段 | 比 FOR UPDATE 稍弱 |
| `FOR SHARE` | 共享保护并阻止冲突更新 | 可能增加等待 |
| `FOR KEY SHARE` | 保护引用 Key 不被删除/改 Key | 外键相关路径常见 |

任务领取模式：

```sql
SELECT id
FROM job
WHERE status = 'ready'
ORDER BY priority DESC, id
FOR UPDATE SKIP LOCKED
LIMIT 10;
```

`SKIP LOCKED` 适合队列式并发 Worker，不适合要求完整一致列表的普通查询，因为它会跳过被锁行。

## 8. 表锁、DDL 与 Advisory Lock

即使应用没有显式 `LOCK TABLE`，SQL 和 DDL 也会自动获取不同表锁模式。高风险场景：

- 长事务持有弱锁，DDL 等待更强锁；
- DDL 进入队列后，又阻塞后续本可兼容的请求；
- 未验证的索引或表重写占用长时间锁；
- 外键变更锁住父子表；
- 连接池会话遗留 Advisory Lock。

Advisory Lock 由应用定义语义。数据库不知道它保护哪个业务对象，所有调用方必须使用完全相同的 Key 规则和获取顺序。

## 9. 等待链与根阻塞者

先找等待者，再沿 `pg_blocking_pids()` 找根阻塞者：

```sql
SELECT
  a.pid,
  a.usename,
  a.application_name,
  a.state,
  a.xact_start,
  a.query_start,
  a.wait_event_type,
  a.wait_event,
  pg_blocking_pids(a.pid) AS blocking_pids,
  left(a.query, 160) AS query
FROM pg_stat_activity AS a
WHERE a.datname = current_database()
ORDER BY a.xact_start NULLS LAST;
```

分析步骤：

```text
waiter
→ requested resource / wait_event
→ direct blocker
→ blocker 是否也在等待
→ root blocker
→ root transaction age / query / application / client
```

不要因为等待者数量多就终止所有等待者。真正的问题通常是最前面的长事务、DDL 或 `idle in transaction` 会话。

终止会话前要判断：

- 正在回滚多少数据；
- 是否是迁移或备份任务；
- 应用会不会立即重连并重放；
- 终止 Backend 还是只取消当前 Query；
- 业务是否允许中断。

## 10. Deadlock

典型死锁：

```text
T1 locks row A → waits row B
T2 locks row B → waits row A
```

PostgreSQL 检测环后终止一个事务。根治方法：

- 所有代码按稳定顺序锁对象；
- 缩短事务；
- 避免事务内调用外部服务；
- 对批量更新排序；
- 正确处理 `deadlock_detected` 并重试整个事务。

单纯调大 `deadlock_timeout` 不会消除死锁，只会改变检测和日志时机。

## 11. 可复现实验

在独立数据库创建：

```sql
CREATE SCHEMA IF NOT EXISTS lab_mvcc;
CREATE TABLE lab_mvcc.account (
  id bigint PRIMARY KEY,
  balance numeric NOT NULL CHECK (balance >= 0),
  version bigint NOT NULL DEFAULT 0
);
INSERT INTO lab_mvcc.account(id, balance)
VALUES (1, 100), (2, 100)
ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance;
```

### 11.1 实验一：Read Committed 与 Repeatable Read {/* #实验一read-committed-与-repeatable-read */}

打开两个 psql 会话：

1. A 在 Read Committed 事务中查询 id=1；
2. B 更新并提交；
3. A 再查，记录结果；
4. 重置数据；
5. A 改用 Repeatable Read，重复实验；
6. 解释两个级别的 Snapshot 生命周期。

### 11.2 实验二：构造锁等待 {/* #实验二构造锁等待 */}

会话 A：

```sql
BEGIN;
SELECT * FROM lab_mvcc.account WHERE id = 1 FOR UPDATE;
```

会话 B 尝试更新同一行，再从第三个会话执行等待链 SQL。记录 blocker PID、事务开始时间和 wait event，然后由 A 正常 COMMIT，确认 B 继续执行。

### 11.3 实验三：死锁 {/* #实验三死锁 */}

仅在实验库让 A、B 以相反顺序锁定 id=1 和 id=2，观察服务端日志、SQLSTATE 和被回滚事务。随后把两个事务都改为按 id 升序获取锁，验证死锁消失。

## 12. 生产防护

按业务类型设置并验证：

- `statement_timeout`：限制单条语句；
- `lock_timeout`：限制等待锁的时间；
- `idle_in_transaction_session_timeout`：清理事务内空闲；
- 连接池事务模式和会话状态重置；
- 慢事务、长 Snapshot、锁等待和死锁告警；
- SQLSTATE 40001/40P01 的有界幂等重试。

超时值不能全库照抄。批处理、迁移和在线请求应使用不同角色或会话配置。

## 13. 验收题

- UPDATE 为什么会产生新 Tuple，而不是简单覆盖旧行？
- `xmin`、`xmax` 和 `ctid` 为什么不适合作为业务版本？
- Read Committed 的两条 SELECT 为什么可见不同数据？
- Repeatable Read 为什么仍可能发生跨行写偏差？
- SSI 为什么会主动回滚一个看似没有锁等待的事务？
- 如何沿等待链找到根阻塞者，而不是误杀所有等待者？
- `SKIP LOCKED` 为什么适合任务队列却不适合一致列表？

## 14. 参考资料 {/* #参考资料 */}

- [MVCC](https://www.postgresql.org/docs/18/mvcc.html)
- [Transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html)
- [Explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)
- [Monitoring database activity](https://www.postgresql.org/docs/18/monitoring-stats.html)
