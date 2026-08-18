---
title: "MySQL 从零到精通学习路线"
sidebar_label: "00. MySQL 从零到精通学习路线"
sidebar_position: 0
description: "以 MySQL 8.4 LTS 为主线，从关系模型与 SQL 开始，系统学习多种部署方式、InnoDB、事务、索引、优化器、高可用、备份恢复、性能和生产故障排查。"
tags: [MySQL, InnoDB, SQL, 数据库, 学习路线]
---

# MySQL 从零到精通学习路线

学习 MySQL 不能只停留在“会写 `SELECT`”或“会改几个配置”。从零到精通需要同时理解三条路径：

```text
一条 SQL 的执行路径
Client → Connection → Parser → Optimizer → Executor → InnoDB → Buffer Pool / Disk

一次事务的持久化路径
Row Change → Undo → Redo → Binlog → Commit → Flush / Replication

一次生产故障的定位路径
业务 SLO → SQL/锁/连接 → MySQL 内部等待 → CPU/内存/磁盘/网络 → 恢复验证
```

这套文章面向开发、运维、SRE、DBA 和数据工程学习者。每个模块都要完成“原理、实验、指标、故障和验收”闭环，而不是背命令。

## 1. 版本基线

本系列以 **MySQL 8.4 LTS** 为主线。实验应使用当前仍受支持、已经修复安全与稳定性问题的 8.4.x 补丁版本，不固定在最初的 8.4.0。

版本使用规则：

1. 文章讲 8.4 LTS 中稳定的架构和行为；
2. 默认值、已废弃参数和命令以实际补丁版本的官方手册与 `--help` 为准；
3. 5.7、8.0 的旧实践会明确标记，不能直接复制到 8.4；
4. Innovation 分支用于了解新特性，不作为初学和生产基线；
5. 每次实验保存 Server、Client、Shell、驱动和操作系统版本。

```sql
SELECT VERSION();
SHOW VARIABLES LIKE 'version%';
```

官方入口：

- [MySQL 8.4 Reference Manual](https://dev.mysql.com/doc/refman/8.4/en/)
- [MySQL 8.4 Release Notes](https://dev.mysql.com/doc/relnotes/mysql/8.4/en/)

## 2. 学习完成后的能力地图

### 2.1 开发能力 {/* #开发能力 */}

- 正确设计表、主键、约束、数据类型和字符集；
- 写出可解释、可测试的 SQL；
- 理解事务边界、隔离级别、锁和死锁；
- 通过 `EXPLAIN ANALYZE` 和真实数据优化查询；
- 正确使用连接池、超时、重试与幂等。

### 2.2 数据库内核能力 {/* #数据库内核能力 */}

- 画出 InnoDB 内存和磁盘结构；
- 解释聚簇索引、二级索引、页分裂和回表；
- 解释 Buffer Pool、Redo、Undo、Doublewrite 和 Binlog；
- 从 Read View、版本链和锁范围解释并发结果；
- 说明 Crash Recovery 为什么能保证已提交事务的持久性。

### 2.3 运维与 SRE 能力 {/* #运维与-sre-能力 */}

- 根据场景选择 RPM、APT、离线二进制、Docker、复制、InnoDB Cluster 或 Kubernetes Operator，并解释其生命周期与持久化原理；
- 建立 QPS、延迟、错误、连接、锁、Redo、Buffer Pool、I/O 和复制看板；
- 根据工作负载做容量规划与基准测试；
- 设计复制、高可用、备份、PITR 和灾难恢复；
- 安全完成 DDL、升级、主从切换和权限变更；
- 从慢 SQL 一直排查到 Linux、NUMA、磁盘与网络。

## 3. 十个学习模块

```text
01 基础与 SQL 入门
→ 02 部署原理与实战
→ 03 Schema 与应用设计
→ 04 InnoDB 与事务内核
→ 05 索引与优化器
→ 06 性能、可观测性与容量
→ 07 复制与高可用
→ 08 备份、恢复与安全
→ 09 生产架构与故障排查
→ 10 命令与实验手册
```

顺序不是绝对限制，但不能跳过事务、索引和恢复基础就直接修改生产参数。

## 4. 完整文章清单

整套路线当前收录 **61 篇**。原有 49 篇继续保留编号，新部署专题使用 D1～D12，避免旧文章编号和外部引用整体漂移。可以按模块顺序学习，也可以沿 P0/P1/P2 和故障场景交叉练习；是否掌握应以能独立部署、观测、压测、恢复和解释数据路径为准。

### 4.1 模块一：基础与 SQL 入门（5 篇） {/* #模块一基础与-sql-入门5-篇 */}

1. [MySQL 解决什么问题及一条 SQL 的完整路径](./01-foundations/01-MySQL解决什么问题及一条SQL的完整路径.md)
2. [安装 MySQL 8.4 LTS 与建立安全实验环境](./01-foundations/02-安装MySQL8.4LTS与建立安全实验环境.md)
3. [mysql 客户端、连接、会话与元数据导航](./01-foundations/03-mysql客户端连接会话与元数据导航.md)
4. [数据库、表、数据类型、字符集与排序规则](./01-foundations/04-数据库表数据类型字符集与排序规则.md)
5. [从 CRUD 到 Join、聚合、CTE 与窗口函数](./01-foundations/05-从CRUD到Join聚合CTE与窗口函数.md)

### 4.2 模块二：部署原理与实战（12 篇） {/* #模块二部署原理与实战12-篇 */}

- D1. [MySQL 部署学习路线与方案选型](./deployment/00-MySQL部署学习路线与方案选型.md)
- D2. [MySQL 部署原理：进程、目录、配置、初始化与启动](./deployment/01-MySQL部署原理-进程目录配置初始化与启动.md)
- D3. [RHEL/Rocky 使用 RPM 仓库部署 MySQL 8.4](./deployment/02-RHEL-Rocky使用RPM仓库部署MySQL8.4.md)
- D4. [Ubuntu/Debian 使用 APT 部署 MySQL 8.4](./deployment/03-Ubuntu-Debian使用APT部署MySQL8.4.md)
- D5. [通用二进制包离线部署与 systemd 托管](./deployment/04-通用二进制包离线部署与systemd托管.md)
- D6. [Docker 与 Compose 部署 MySQL](./deployment/05-Docker与Compose部署MySQL.md)
- D7. [源码编译部署 MySQL 与适用边界](./deployment/06-源码编译部署MySQL与适用边界.md)
- D8. [主从与半同步复制生产部署](./deployment/07-主从半同步复制生产部署.md)
- D9. [InnoDB Cluster 与 Router 高可用部署](./deployment/08-InnoDBCluster与Router高可用部署.md)
- D10. [MySQL Operator 在 Kubernetes 生产部署](./deployment/09-MySQL-Operator在Kubernetes生产部署.md)
- D11. [Ansible 自动化批量部署 MySQL](./deployment/10-Ansible自动化批量部署MySQL.md)
- D12. [部署验收、安全、监控、备份与故障排查](./deployment/11-部署验收安全监控备份与故障排查.md)

### 4.3 模块三：Schema 与应用设计（5 篇） {/* #模块三schema-与应用设计5-篇 */}

6. [主键、唯一约束、外键、NULL 与数据完整性](./02-schema-application/01-主键唯一外键NULL与数据完整性.md)
7. [范式、反范式、宽表与关系建模](./02-schema-application/02-范式反范式宽表与关系建模.md)
8. [时间、金额、字符集、JSON 与数据类型陷阱](./02-schema-application/03-时间金额字符集JSON与类型陷阱.md)
9. [Online DDL、Metadata Lock 与 Schema 变更](./02-schema-application/04-Online-DDL-MDL与Schema变更.md)
10. [连接池、Prepared Statement、事务边界、超时与重试](./02-schema-application/05-连接池Prepared-Statement事务超时与重试.md)

### 4.4 模块四：InnoDB 与事务内核（7 篇） {/* #模块四innodb-与事务内核7-篇 */}

11. [InnoDB 内存与磁盘整体架构](./03-innodb-transactions/01-InnoDB内存与磁盘整体架构.md)
12. [Page、Row Format、聚簇索引与二级索引](./03-innodb-transactions/02-Page-RowFormat聚簇索引与二级索引.md)
13. [Buffer Pool、脏页、刷盘、Change Buffer 与 Doublewrite](./03-innodb-transactions/03-BufferPool脏页刷盘ChangeBuffer与Doublewrite.md)
14. [Redo、Undo、Binlog 与一次提交的完整路径](./03-innodb-transactions/04-Redo-Undo-Binlog与一次提交的完整路径.md)
15. [ACID、隔离级别、MVCC、版本链与 Read View](./03-innodb-transactions/05-ACID隔离级别MVCC版本链与ReadView.md)
16. [行锁、间隙锁、Next-Key Lock、MDL 与死锁](./03-innodb-transactions/06-行锁间隙锁NextKeyLock-MDL与死锁.md)
17. [Checkpoint、Crash Recovery 与持久性边界](./03-innodb-transactions/07-Checkpoint-CrashRecovery与持久性边界.md)

### 4.5 模块五：索引与优化器（6 篇） {/* #模块五索引与优化器6-篇 */}

18. [B+Tree、联合索引、最左前缀、覆盖索引与回表](./04-index-optimizer/01-BTree联合索引最左前缀覆盖索引与回表.md)
19. [EXPLAIN、EXPLAIN ANALYZE 与执行计划阅读](./04-index-optimizer/02-EXPLAIN与EXPLAIN-ANALYZE执行计划阅读.md)
20. [成本模型、统计信息、直方图与基数估算](./04-index-optimizer/03-成本模型统计信息直方图与基数估算.md)
21. [Join、子查询、CTE、排序与临时表的执行原理](./04-index-optimizer/04-Join子查询CTE排序与临时表执行原理.md)
22. [慢 SQL 从发现、归因、改写到回归验证](./04-index-optimizer/05-慢SQL发现归因改写与回归验证.md)
23. [深分页、COUNT、批量写入与热点更新优化](./04-index-optimizer/06-深分页COUNT批量写入与热点更新优化.md)

### 4.6 模块六：性能、可观测性与容量（6 篇） {/* #模块六性能可观测性与容量6-篇 */}

24. [MySQL 配置分层、内存预算、连接与线程模型](./05-performance-capacity/01-MySQL配置分层内存预算连接与线程模型.md)
25. [Performance Schema、sys Schema 与关键状态指标](./05-performance-capacity/02-PerformanceSchema-sysSchema与关键状态指标.md)
26. [CPU、内存、磁盘、文件系统、NUMA 与网络联合排查](./05-performance-capacity/03-CPU内存磁盘文件系统NUMA与网络联合排查.md)
27. [sysbench 基准测试、工作负载建模与结果解释](./05-performance-capacity/04-sysbench基准测试工作负载建模与结果解释.md)
28. [QPS、数据增长、IOPS、复制与备份容量规划](./05-performance-capacity/05-QPS数据增长IOPS复制与备份容量规划.md)
29. [数据库 SLI/SLO、Dashboard、告警与变更关联](./05-performance-capacity/06-数据库SLI-SLO-Dashboard告警与变更关联.md)

### 4.7 模块七：复制与高可用（5 篇） {/* #模块七复制与高可用5-篇 */}

30. [Binlog Format、Position、GTID 与复制数据路径](./06-replication-ha/01-BinlogFormat-Position-GTID与复制数据路径.md)
31. [异步复制、半同步复制与只读副本搭建](./06-replication-ha/02-异步半同步复制与只读副本搭建.md)
32. [复制延迟、并行回放、错误与数据一致性排查](./06-replication-ha/03-复制延迟并行回放错误与数据一致性排查.md)
33. [主从切换、脑裂、数据丢失边界与故障演练](./06-replication-ha/04-主从切换脑裂数据丢失边界与故障演练.md)
34. [Group Replication、InnoDB Cluster 与 MySQL Router](./06-replication-ha/05-GroupReplication-InnoDBCluster与MySQLRouter.md)

### 4.8 模块八：备份、恢复与安全（5 篇） {/* #模块八备份恢复与安全5-篇 */}

35. [备份不是复制：RPO、RTO、一致性与保留策略](./07-backup-security/01-备份不是复制-RPO-RTO一致性与保留策略.md)
36. [逻辑备份、导出导入与跨版本迁移](./07-backup-security/02-逻辑备份导出导入与跨版本迁移.md)
37. [物理备份、Clone 与大库恢复设计](./07-backup-security/03-物理备份Clone与大库恢复设计.md)
38. [Binlog PITR、误删恢复与灾难恢复演练](./07-backup-security/04-Binlog-PITR误删恢复与灾难恢复演练.md)
39. [账户、角色、最小权限、TLS、加密、审计与密钥](./07-backup-security/05-账户角色最小权限TLS加密审计与密钥.md)

### 4.9 模块九：生产架构与故障排查（5 篇） {/* #模块九生产架构与故障排查5-篇 */}

40. [MySQL 版本升级、兼容性、回滚与灰度验证](./08-production-operations/01-MySQL版本升级兼容性回滚与灰度验证.md)
41. [MySQL on Kubernetes、Operator、存储与反模式](./08-production-operations/02-MySQL-on-Kubernetes-Operator存储与反模式.md)
42. [Debezium CDC、Transactional Outbox 与 Schema Change](./08-production-operations/03-Debezium-CDC-TransactionalOutbox与SchemaChange.md)
43. [ProxySQL、Orchestrator 与读写路由架构](./08-production-operations/04-ProxySQL-Orchestrator与读写路由架构.md)
44. [MySQL 生产故障排查 Runbook 与事故复盘](./08-production-operations/05-MySQL生产故障排查Runbook与事故复盘.md)

### 4.10 模块十：命令与实验手册（5 篇） {/* #模块十命令与实验手册5-篇 */}

45. [`mysql` 命令完整参考与安全连接](./09-command-labs/01-mysql命令完整参考与安全连接.md)
46. [`mysqladmin`、`mysqlcheck` 与实例维护命令](./09-command-labs/02-mysqladmin-mysqlcheck与实例维护命令.md)
47. [`mysqldump`、`mysqlbinlog` 与备份恢复命令](./09-command-labs/03-mysqldump-mysqlbinlog与备份恢复命令.md)
48. [MySQL Shell、AdminAPI 与 InnoDB Cluster 命令](./09-command-labs/04-MySQLShell-AdminAPI与InnoDBCluster命令.md)
49. [管理 SQL、Performance Schema 与故障实验手册](./09-command-labs/05-管理SQL-PerformanceSchema与故障实验手册.md)

## 5. P0、P1 与 P2

### 5.1 P0：必须掌握 {/* #p0必须掌握 */}

- 文章 1～23：SQL、数据模型、InnoDB、事务、锁、索引和执行计划；
- 部署 D1～D6、D12：部署共同原理、主流单实例交付和统一上线验收；
- 文章 25：Performance Schema；
- 文章 30：Binlog/GTID；
- 文章 35～38：备份和恢复；
- 文章 44：故障 Runbook。

P0 的验收不是笔试，而是能解释一条慢查询、一次死锁、一次提交与一次恢复。

### 5.2 P1：生产必需 {/* #p1生产必需 */}

- 部署 D7～D11，以及性能、容量、复制、高可用、监控、安全、DDL、升级与 Kubernetes；
- 能在预生产完成压力、故障、备份恢复和切换演练；
- 能建立 SLO、变更审计和容量水位。

### 5.3 P2：按岗位深入 {/* #p2按岗位深入 */}

- 优化器 Trace、InnoDB 内部数据结构、源码和 eBPF/perf；
- 超大实例、跨地域容灾、多租户数据库平台；
- Proxy/Operator 二次开发和自动化自治。

## 6. 每篇文章的学习闭环

每篇必须完成六步：

1. **画路径**：画出 SQL、事务或故障涉及的进程、内存、日志和磁盘；
2. **做实验**：在隔离环境创建最小复现场景；
3. **看状态**：保存 SQL 输出、错误日志、Performance Schema 和系统指标；
4. **制造故障**：锁等待、慢盘、进程退出、复制中断或误删；
5. **完成恢复**：证明数据正确，而不只是进程重新启动；
6. **写结论**：说明根因、证据、修复、副作用和回滚条件。

生产环境命令必须区分：

```text
[R] 只读观察
[A] 有限管理操作
[W] 改写数据或配置
[D] 破坏性/不可逆风险
```

命令手册会统一使用这一分级。

## 7. 推荐实验环境

学习阶段准备三个层次：

```text
单实例
  SQL、事务、索引、恢复基础

三实例复制环境
  Source、Replica、GTID、延迟、切换

监控与故障环境
  Prometheus/Exporter、sysbench、慢盘/网络/进程故障
```

每个环境必须使用非生产数据、独立端口和独立数据目录。所有破坏性实验先验证目标实例：

```sql
SELECT @@hostname, @@port, @@server_uuid, @@read_only, @@super_read_only;
```

## 8. 最终验收

完成 61 篇后，应能独立完成：

- 从需求设计 Schema、索引、事务和查询；
- 根据环境完成包管理、离线、容器、复制、InnoDB Cluster、Operator 与自动化部署，并解释各自原理和故障边界；
- 解释 SQL 从连接到 InnoDB Page 的完整路径；
- 从 `EXPLAIN ANALYZE`、Performance Schema 和 Linux 指标定位性能问题；
- 计算内存、连接、数据增长、IOPS、Binlog 和备份容量；
- 搭建并验证复制、高可用、备份与 PITR；
- 安全执行 DDL、升级、切换、扩容和权限变更；
- 处理慢 SQL、锁等待、死锁、连接打满、复制延迟、磁盘满、OOM、误删和实例崩溃；
- 用 RPO、RTO、SLO 和恢复验证证明系统真正可靠。

从零到精通的标准不是“知道全部参数”，而是面对未知问题时，能够沿数据、日志、锁、资源和时间线找到证据。
