---
title: "连接进程、PgBouncer、内存、Huge Pages 与 I/O"
sidebar_label: "12. 连接进程、PgBouncer、内存、Huge Pages 与 I/O"
sidebar_position: 12
description: "预算 PostgreSQL 连接、共享/每操作内存、Huge Pages、Page Cache 和存储。"
tags: [PostgreSQL, PgBouncer, 内存, I/O]
---

# 连接进程、PgBouncer、内存、Huge Pages 与 I/O

PostgreSQL 通常每客户端连接一个 Backend。连接数提高会增加进程内存、调度、锁数组和并发查询资源，不应直接把 `max_connections` 调到几千。

## 1. PgBouncer {/* #pgbouncer */}

| 模式 | 复用范围 | 限制 |
| --- | --- | --- |
| session | 整个客户端会话 | 复用率低，语义完整 |
| transaction | 每事务 | session state、临时表、部分 prepared 行为受限 |
| statement | 每语句 | 多语句事务不适用 |

应用必须在连接池等待和数据库并发之间设置背压。数据库连接耗尽时让无限请求排队只会放大超时。

## 2. 内存 {/* #内存 */}

```text
shared_buffers
+ backend/process base
+ concurrent operations × work_mem (sort/hash nodes)
+ maintenance/autovacuum memory
+ WAL and extensions
+ OS Page Cache
```

`work_mem` 是每个执行节点、每个并行 worker 的潜在预算，不是每连接固定只用一次。根据并发计划和 spill 证据设置。

Huge Pages 可降低共享内存页表开销，需 OS 预留和启动验证；Transparent Huge Pages 对数据库延迟可能不友好，应按平台建议验证。

## 3. I/O {/* #io */}

区分数据读、WAL 顺序写、checkpoint 写、temp spill 和备份流量。用数据库 I/O 视图、`iostat`/eBPF、fsync 延迟关联，不能只看磁盘利用率百分比。

## 4. 连接与内存容量实验 {/* #连接与内存容量实验 */}

```text
总内存 ≠ shared_buffers + max_connections × work_mem
还要考虑每会话/后台进程、并发算子倍数、maintenance_work_mem、OS page cache 与连接池
```

使用真实事务并发逐步提高连接数，记录 TPS、P95/P99、active/idle/waiting、上下文切换、RSS、page fault 和磁盘延迟。`work_mem` 可被一个查询的多个 sort/hash 节点和并行 worker 分别使用，不能直接设成“剩余内存/连接数”。

```sql
SELECT state, wait_event_type, wait_event, count(*) FROM pg_stat_activity GROUP BY 1,2,3;
SELECT * FROM pg_stat_io;
```

PgBouncer transaction pooling 会改变 session 状态、临时表、LISTEN/NOTIFY、prepared statement 等语义，应用必须做兼容测试。HugePages 与 IO 参数按 OS/数据库版本和实测调整；任何优化都同时检查吞吐、长尾、OOM 风险和恢复时间。

## 5. 验收题 {/* #验收题 */}

- transaction pooling 破坏哪些 session 语义？
- work_mem 为什么不能乘连接数简单估计？
- Shared Buffers 与 OS Page Cache 如何共存？
- CPU 低但连接池等待高说明什么？

## 6. 参考资料 {/* #参考资料 */}

- [Resource consumption](https://www.postgresql.org/docs/18/runtime-config-resource.html)
- [PgBouncer](https://www.pgbouncer.org/usage.html)
