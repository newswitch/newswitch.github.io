---
title: "PostgreSQL 解决什么问题与一条 SQL 的完整路径"
sidebar_label: "01. PostgreSQL 解决什么问题与一条 SQL 的完整路径"
sidebar_position: 1
tags: [PostgreSQL, SQL, MVCC, WAL, 查询执行]
description: "从进程模型、解析优化、Buffer Cache、MVCC、WAL 与提交时间点拆解 PostgreSQL 一条 SQL 的完整路径。"
---

# PostgreSQL 解决什么问题与一条 SQL 的完整路径

PostgreSQL 是以 SQL、事务、可靠恢复和可扩展类型/索引体系为核心的关系数据库。学 PostgreSQL 的起点不是记 `psql` 命令，而是理解客户端连接后由谁执行 SQL、数据页怎样进入内存、MVCC 如何决定可见性、WAL 为什么先于数据页持久化，以及一次提交成功究竟承诺了什么。

## 1. PostgreSQL 在系统中的位置

它适合保存需要约束、事务和长期恢复的权威事实：订单、账户、库存、配置元数据和业务关系。Redis、Elasticsearch、ClickHouse 与 Milvus 往往是这些事实的缓存或派生视图。

PostgreSQL 的鲜明能力包括丰富 SQL、MVCC、多种索引、JSONB、扩展机制、逻辑复制以及严谨的事务语义。但“功能多”不代表可以忽略建模：把所有数据塞入 JSONB、建立大量无用索引、让长事务永久存在，同样会破坏性能和可维护性。

## 2. 进程与内存地图

典型 Linux 部署中：

```text
postmaster / postgres parent
  ├─ backend process per client connection
  ├─ checkpointer
  ├─ background writer
  ├─ WAL writer
  ├─ autovacuum launcher / workers
  ├─ archiver（若启用）
  └─ replication sender / receiver

shared memory
  ├─ shared_buffers
  ├─ WAL buffers
  └─ locks and process state
```

默认是一连接一后端进程，而不是每条 SQL 新建进程。高连接数会带来进程内存、调度和争用成本，因此生产环境常使用连接池，并区分 session、transaction pooling 对会话状态和 prepared statement 的影响。

## 3. 一条 SELECT 的路径

```text
Client / driver
→ DNS/TCP/TLS
→ pg_hba.conf authentication
→ backend process
→ parse SQL into syntax tree
→ analyze names and types
→ rewrite rules/views
→ planner estimates rows and costs
→ choose scan/join/aggregate plan
→ executor obtains MVCC snapshot
→ read page from shared_buffers or storage
→ visibility check and predicate evaluation
→ sort/aggregate/join
→ serialize rows
→ network response
```

优化器根据统计信息估算行数，再在顺序扫描、索引扫描、连接顺序和算法之间选择成本较低的计划。执行计划差的根因经常不是“优化器坏了”，而是统计信息失真、数据倾斜、条件相关性、类型转换、参数化计划或索引设计与查询不匹配。

`EXPLAIN (ANALYZE, BUFFERS)` 能显示真实执行时间和缓冲区访问，但会真正执行语句；对写语句或生产重查询必须谨慎。

## 4. MVCC：同一行为什么能有多个版本

更新一行时，PostgreSQL 通常创建新 tuple version，并让旧版本在适当快照下仍可见。每个事务依据隔离级别和 snapshot 判断哪些版本可见。

```text
UPDATE
→ create new tuple version
→ old version becomes dead only when no relevant snapshot needs it
→ VACUUM later marks space reusable
```

因此：

- `UPDATE`/`DELETE` 不会立即缩小表文件；
- 长事务和长期复制槽可能阻止旧版本回收；
- Autovacuum 不是可选清洁工具，而是 MVCC 正常运转的一部分；
- 索引也可能保留指向旧版本的条目并发生膨胀；
- HOT update 是否成立取决于被更新列、索引和页内空间。

## 5. 一条事务写入与 WAL

以事务更新订单为例：

```text
BEGIN
→ lock / locate visible tuple
→ modify buffer page and mark dirty
→ generate WAL records
→ COMMIT record enters WAL
→ synchronous_commit policy waits for required WAL durability/replica state
→ COMMIT response
→ dirty data page may be written later
→ checkpoint controls recovery starting point
```

WAL 的基本约束是相关 WAL 必须先于数据页写入稳定存储，这样宕机后可从最近 checkpoint 开始重放日志恢复。提交并不要求每个脏数据页立即落盘；它主要要求提交日志达到配置承诺的持久化阶段。

需要区分：

- `fsync`、`synchronous_commit`、`full_page_writes` 的职责；
- 本地 WAL 刷盘和同步副本确认的不同等待点；
- WAL archive、base backup 与 PITR 的组合；
- 复制“已接收、已写、已刷盘、已重放”不是同一状态。

## 6. 锁、MVCC 与隔离不是同一件事

MVCC 减少读写互斥，但不会消灭锁。DDL、外键、唯一约束、行更新、显式锁和 predicate locking 都可能阻塞或检测冲突。

排查“数据库卡住”时要建立等待链：

```text
waiting backend
→ wait_event / requested lock
→ blocking backend
→ blocking transaction age and SQL
→ application owner
→ safe cancel or terminate decision
```

不能看到一个长 SQL 就直接杀进程；它可能是受害者，而真正阻塞者是一个 idle in transaction 会话。

## 7. 第一轮性能证据

| 层次 | 证据 |
| --- | --- |
| 应用 | 连接池等待、事务范围、重试、请求 P99 |
| 会话 | `pg_stat_activity`、state、wait_event、事务年龄 |
| SQL | `pg_stat_statements`、调用次数、总/均值/尾部采样 |
| 执行 | `EXPLAIN (ANALYZE, BUFFERS)`、估算与真实行数 |
| 表/索引 | 扫描、命中、dead tuples、膨胀、统计信息 |
| WAL/Checkpoint | WAL 速率、checkpoint 时长与写入尖峰 |
| 系统 | CPU、内存、Page Cache、存储时延/IOPS/吞吐、网络 |

Shared buffer hit 高不等于没有磁盘问题，操作系统 Page Cache 也参与 I/O；CPU 利用率低也不等于没有锁等待、连接池等待或同步提交等待。

## 8. 最小实验

在独立测试实例创建一张带主键和状态列的小表：

1. 使用 `EXPLAIN (ANALYZE, BUFFERS)` 比较主键点查和无索引过滤；
2. 打开两个会话，让第一个事务更新后不提交，观察第二个会话的等待事件；
3. 更新同一行多次，观察 tuple 统计与 `VACUUM` 前后变化；
4. 记录一次 checkpoint 前后的 WAL、写入和时延；
5. 检查 `SHOW data_directory`、`SHOW wal_level`、`SHOW synchronous_commit`，但不要在不了解影响时修改生产参数。

实验要记录 PostgreSQL 大版本、配置差异、数据量和存储类型。执行完关闭长事务并删除实验对象。

## 9. 验收问题

- PostgreSQL 为什么采用 backend process，而连接池解决的主要成本是什么？
- 一条 SELECT 在 Planner 和 Executor 分别发生什么？
- 提交成功时为什么数据页可以还没落盘？
- WAL、checkpoint、base backup 与 archive 怎样共同完成 PITR？
- 长事务为什么会造成表膨胀和复制压力？
- CPU 不高但 SQL P99 上升，怎样区分锁、I/O、连接池和错误计划？

## 10. 参考资料

- [PostgreSQL 18 文档](https://www.postgresql.org/docs/18/)
- [查询路径](https://www.postgresql.org/docs/18/query-path.html)
- [并发控制](https://www.postgresql.org/docs/18/mvcc.html)
- [WAL](https://www.postgresql.org/docs/18/wal-intro.html)
- [例行 Vacuum](https://www.postgresql.org/docs/18/routine-vacuuming.html)
