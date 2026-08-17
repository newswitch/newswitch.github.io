---
title: "连接进程、PgBouncer、内存、Huge Pages 与 I/O"
sidebar_position: 12
tags: [PostgreSQL, PgBouncer, 内存, I/O]
description: "预算 PostgreSQL 连接、共享/每操作内存、Huge Pages、Page Cache 和存储。"
---

# 连接进程、PgBouncer、内存、Huge Pages 与 I/O

PostgreSQL 通常每客户端连接一个 Backend。连接数提高会增加进程内存、调度、锁数组和并发查询资源，不应直接把 `max_connections` 调到几千。

## PgBouncer

| 模式 | 复用范围 | 限制 |
| --- | --- | --- |
| session | 整个客户端会话 | 复用率低，语义完整 |
| transaction | 每事务 | session state、临时表、部分 prepared 行为受限 |
| statement | 每语句 | 多语句事务不适用 |

应用必须在连接池等待和数据库并发之间设置背压。数据库连接耗尽时让无限请求排队只会放大超时。

## 内存

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

## I/O

区分数据读、WAL 顺序写、checkpoint 写、temp spill 和备份流量。用数据库 I/O 视图、`iostat`/eBPF、fsync 延迟关联，不能只看磁盘利用率百分比。

## 验收题

- transaction pooling 破坏哪些 session 语义？
- work_mem 为什么不能乘连接数简单估计？
- Shared Buffers 与 OS Page Cache 如何共存？
- CPU 低但连接池等待高说明什么？

## 参考资料

- [Resource consumption](https://www.postgresql.org/docs/18/runtime-config-resource.html)
- [PgBouncer](https://www.pgbouncer.org/usage.html)
