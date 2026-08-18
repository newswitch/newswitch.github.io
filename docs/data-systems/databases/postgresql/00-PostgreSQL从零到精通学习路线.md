---
title: "PostgreSQL 从零到精通学习路线"
sidebar_label: "00. PostgreSQL 从零到精通学习路线"
sidebar_position: 0
description: "以 PostgreSQL 18 为主线，从 SQL 和数据建模深入 MVCC、WAL、查询优化、Vacuum、复制、PITR、高可用、性能容量和源码。"
tags: [PostgreSQL, MVCC, WAL, SQL, 高可用, 学习路线]
---

# PostgreSQL 从零到精通学习路线

PostgreSQL 与 MySQL 都是关系数据库，但不能把 MySQL 经验逐项替换参数后直接照搬。PostgreSQL 的 Heap/Tuple、MVCC、WAL、Vacuum、Visibility Map、FSM、Planner、Extension、物理/逻辑复制和 Timeline 有自己完整的因果链。

本路线以 **PostgreSQL 18** 稳定分支为主线，实验使用当前受支持的 18.x 补丁版；开发中的下一大版本只用于观察新特性，不作为生产基线。

## 1. 三条核心路径

```text
SQL path
Client → Backend Process → Parser/Rewriter → Planner → Executor → Access Method

Transaction path
Tuple Version → Shared Buffers → WAL Buffer → WAL Flush → Data Page / Checkpoint

Maintenance path
Dead Tuple → Vacuum → Visibility Map / FSM → Freeze → Bloat Control
```

## 2. 篇文章学习清单 {/* #2-19-篇文章学习清单 */}

| 编号 | 文章 | 优先级 | 核心问题 | 收录情况 |
| --- | --- | --- | --- | --- |
| P00 | PostgreSQL 从零到精通学习路线 | P0 | 建立 SQL、WAL、MVCC 和运维地图 | 已收录 |
| P01 | [PostgreSQL 解决什么问题与一条 SQL 的完整路径](./01-PostgreSQL解决什么问题与一条SQL的完整路径.md) | P0 | 进程模型、数据库对象和执行入口 | 已收录 |
| P02 | [安装、Docker、源码、Linux Package 与安全实验环境](./02-PostgreSQL安装Docker源码Linux-Package与安全实验环境.md) | P0 | 多种部署方式和初始化原理 | 已收录 |
| P03 | [psql、Database、Schema、Role 与元数据导航](./03-psql-Database-Schema-Role与元数据导航.md) | P0 | 对象层级、连接与权限基础 | 已收录 |
| P04 | [类型、约束、Sequence、Partition 与 Schema 设计](./04-PostgreSQL类型约束Sequence分区与Schema设计.md) | P0 | 正确建模和演进边界 | 已收录 |
| P05 | [SQL、CTE、Window、JSONB、Array 与全文检索](./05-PostgreSQL-SQL-CTE-Window-JSONB-Array与全文检索.md) | P0 | PostgreSQL SQL 能力及代价 | 已收录 |
| P06 | [Page、Heap Tuple、TOAST、FSM 与 Visibility Map](./06-PostgreSQL-Page-Heap-Tuple-TOAST-FSM与Visibility-Map.md) | P0 | 行怎样存储、宽字段在哪里 | 已收录 |
| P07 | [MVCC、Snapshot、隔离级别、锁与 SSI](./07-PostgreSQL-MVCC-Snapshot隔离级别锁与SSI.md) | P0 | 并发可见性、阻塞和序列化失败 | 已收录 |
| P08 | [WAL、Commit、Checkpoint、Crash Recovery 与 Timeline](./08-PostgreSQL-WAL-Commit-Checkpoint恢复与Timeline.md) | P0 | 持久性和恢复边界 | 已收录 |
| P09 | [Vacuum、Autovacuum、Freeze、XID Wraparound 与 Bloat](./09-PostgreSQL-Vacuum-Autovacuum-Freeze与Bloat.md) | P0 | 为什么数据库必须持续清理 | 已收录 |
| P10 | [B-Tree、GIN、GiST、BRIN、Hash 与索引设计](./10-PostgreSQL-BTree-GIN-GiST-BRIN-Hash索引设计.md) | P0 | 不同访问方法怎样选 | 已收录 |
| P11 | [Planner、统计信息、EXPLAIN ANALYZE 与 Join](./11-PostgreSQL-Planner统计信息EXPLAIN与Join.md) | P0 | 计划为何选错、如何证明 | 已收录 |
| P12 | [连接进程、PgBouncer、内存、Huge Pages 与 I/O](./12-PostgreSQL连接PgBouncer内存HugePages与IO.md) | P1 | 连接与资源如何预算 | 已收录 |
| P13 | [流复制、同步复制、Replication Slot 与 Hot Standby](./13-PostgreSQL流复制同步复制Slot与Hot-Standby.md) | P1 | WAL 复制、延迟、冲突和 RPO | 已收录 |
| P14 | [Patroni、etcd、HAProxy 与自动故障转移](./14-Patroni-etcd-HAProxy与自动故障转移.md) | P1 | DCS、选主、fencing 和接入 | 已收录 |
| P15 | [逻辑复制、Publication/Subscription、CDC 与迁移](./15-PostgreSQL逻辑复制Publication-Subscription与CDC.md) | P1 | 表级复制、DDL 和冲突边界 | 已收录 |
| P16 | [pg_dump、pg_basebackup、WAL Archive 与 PITR](./16-pg_dump-pg_basebackup-WAL归档与PITR.md) | P0 | 备份链、Timeline 和恢复验证 | 已收录 |
| P17 | [性能、容量、监控、安全、升级与故障 Runbook](./17-PostgreSQL性能容量监控安全升级与故障Runbook.md) | P1 | 生产 SRE 完整闭环 | 已收录 |
| P18 | [PostgreSQL 源码、Extension、Hook 与内核调试](./18-PostgreSQL源码Extension-Hook与内核调试.md) | P2 | 从 Backend 追到存储和扩展点 | 已收录 |

当前路线收录 19 篇文章。是否掌握应以能设计约束和索引、解释 MVCC/WAL、完成 PITR 与主备切换，并用等待事件和执行计划定位故障为准。

## 3. 学习阶段

### 3.1 阶段一：SQL 与对象模型 {/* #阶段一sql-与对象模型 */}

完成 P01～P05。要能解释 Database 与 Schema 的边界、Role 与 User 的关系、`search_path` 风险、Sequence 不保证无间隙，以及 JSONB/Array 何时会破坏关系建模。

### 3.2 阶段二：存储与事务内核 {/* #阶段二存储与事务内核 */}

完成 P06～P09。重点理解 PostgreSQL 更新通常产生新 Tuple 版本，旧版本需要 Vacuum 清理；长事务、复制 Slot 和失败的 Autovacuum 会共同造成膨胀甚至 XID 风险。

### 3.3 阶段三：索引和优化器 {/* #阶段三索引和优化器 */}

完成 P10～P12。不能只看 `cost` 或“有没有走索引”，而要结合 `actual rows/time/loops/buffers/WAL/temp` 和统计估算误差判断。

### 3.4 阶段四：高可用和恢复 {/* #阶段四高可用和恢复 */}

完成 P13～P16。分清：

```text
Streaming Replication：复制 WAL
Synchronous Replication：提交等待策略
Patroni：基于 DCS 的自动管理和故障转移
WAL Archive + Base Backup：PITR 恢复链
Logical Replication：按对象发布/订阅逻辑变化
```

PostgreSQL 自身不提供完整的故障检测、fencing 和客户端路由系统；自动高可用必须把 DCS、代理、旧主隔离和应用重连一起设计。

### 3.5 阶段五：生产与源码 {/* #阶段五生产与源码 */}

完成 P17～P18，从 SLO 定位到 Backend、Lock、Planner、WAL、Vacuum、CPU/内存/磁盘，再进入源码和 Extension。

## 4. P0 验收题

- PostgreSQL 为什么通常一个连接对应一个 Backend 进程？
- UPDATE 后旧 Tuple 去哪里，什么时候能被回收？
- 长事务为什么会影响 Vacuum 和存储膨胀？
- WAL 已刷盘但数据页没刷盘，崩溃后怎样恢复？
- `EXPLAIN ANALYZE` 为什么可能改变被测 SQL 的真实影响？
- Standby 已收到 WAL 与已回放 WAL 有什么不同？
- Replication Slot 为什么既防止日志过早删除，又可能撑满主库磁盘？
- Failover 后旧 Primary 为什么必须 fencing？
- Base Backup 成功为什么还不能证明 PITR 可用？

## 5. 实验拓扑

```text
单实例：SQL、Page、MVCC、锁、WAL、Vacuum、Planner
Primary + 2 Standby：异步/同步、Hot Standby、Slot、延迟
3 Patroni + 3 etcd：Leader、DCS、fencing、故障切换
备份环境：Base Backup + WAL Archive + Timeline + PITR
迁移环境：Publication/Subscription + DDL/Sequence 校验
```

## 6. 与 MySQL 的对照学习

| PostgreSQL | MySQL/InnoDB | 不可直接等同的原因 |
| --- | --- | --- |
| Heap Tuple + Index | 聚簇索引记录 | 主数据组织方式不同 |
| WAL | Redo + Binlog | 复制和逻辑日志边界不同 |
| Vacuum | Undo purge | 版本清理机制不同 |
| Process per connection | Thread per connection | 资源与池化模型不同 |
| Schema in Database | Database/Schema 常被近似使用 | 名称空间与权限不同 |
| Physical/Logical Replication | Binlog replication | 日志格式和对象边界不同 |

对照用于建立差异，不用于强行寻找一一对应参数。

## 7. 官方资料

- [PostgreSQL 18 Documentation](https://www.postgresql.org/docs/18/)
- [Backup and Restore](https://www.postgresql.org/docs/18/backup.html)
- [High Availability、Load Balancing 与 Replication](https://www.postgresql.org/docs/18/high-availability.html)
- [PostgreSQL Source Code](https://git.postgresql.org/gitweb/?p=postgresql.git)

最终目标不是背 `postgresql.conf`，而是能沿 Tuple、Snapshot、WAL、Vacuum、Plan 和 Timeline 找到生产问题的证据。
