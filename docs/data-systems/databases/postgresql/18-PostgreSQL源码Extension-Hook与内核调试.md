---
title: "PostgreSQL 源码、Extension、Hook 与内核调试"
sidebar_label: "18. PostgreSQL 源码、Extension、Hook 与内核调试"
sidebar_position: 18
description: "从 postmaster/backend、Parser/Planner/Executor 到存储/WAL，并理解扩展与 Hook 边界。"
tags: [PostgreSQL, 源码, Extension, Hook, Debug]
---

# PostgreSQL 源码、Extension、Hook 与内核调试

> 版本基线：PostgreSQL 18.x。源码阅读、Extension 编译和符号调试必须固定精确 Tag、编译选项与 Extension 版本；PostgreSQL 不承诺跨 Major 稳定的 Server C ABI。

这篇文章的目标是能回答：一条 SQL 进入 Backend 后经过哪些阶段；每个阶段的核心数据结构在哪里；为什么一个 C Extension 或 Hook 能影响整个数据库进程；如何在隔离环境复现并证明问题。

## 1. 进程模型：先知道代码运行在哪 {/* #进程模型先知道代码运行在哪 */}

```text
postmaster
├─ client backend process × N
├─ checkpointer / background writer / walwriter
├─ autovacuum launcher & workers
├─ archiver / walsender / walreceiver / startup
├─ logical replication workers
└─ extension background workers

共享：shared memory、buffer pool、lock table、WAL buffers、catalog caches 的共享部分
私有：每个 Backend 的地址空间、MemoryContext、Transaction/Portal 状态
```

Unix 上 Postmaster 接受连接并为 Client 创建 Backend。一个 C Extension 崩溃通常先终止所在 Backend，但 PostgreSQL 会把异常子进程视为共享内存可能损坏，触发其他 Backend 重启恢复，所以“只影响一个查询”并不成立。

## 2. 源码地图：按职责导航 {/* #源码地图按职责导航 */}

```text
src/backend/postmaster   postmaster、辅助进程、后台 worker 生命周期
src/backend/tcop         SQL 协议主循环、Portal、Command 分发
src/backend/parser       lexer/parser、Parse Analysis、类型/名字绑定
src/backend/rewrite      Rule/View Rewrite
src/backend/optimizer    Planner、Path、Cost、Plan
src/backend/executor     PlanState、Executor 生命周期、表达式执行
src/backend/access       Heap/Index/Table AM、Transaction、WAL
src/backend/storage      Buffer、Lock/LWLock、IPC、File
src/backend/catalog      System Catalog 定义与维护
src/backend/utils        Cache、GUC、MemoryContext、错误、数据类型
src/include              Backend 内部与 Server Extension Headers
contrib                  官方附带 Extension 示例
src/test                 Regression、Isolation、TAP 等测试
```

不要顺序通读所有目录。先选择一个外部现象，例如“为什么这条 SQL 选 Hash Join”或“UPDATE 在哪里写 WAL”，从函数、日志文本、Tracepoint 或数据结构反向追踪。

## 3. 一条 SQL 的完整路径 {/* #一条-sql-的完整路径 */}

### 3.1 Simple Query Protocol {/* #simple-query-protocol */}

```text
libpq/JDBC 发 Query 消息
→ src/backend/tcop/postgres.c 主循环
→ exec_simple_query
→ pg_parse_query：SQL 文本 → RawStmt/Parse Tree
→ parse analysis：名字、类型、函数、权限相关语义绑定
→ Query Rewrite：View/Rule 等展开
→ Planner/Optimizer：RelOptInfo/Path → PlannedStmt/Plan
→ Portal + ExecutorStart/Run/Finish/End
→ Table/Index AM → Buffer Manager → Storage
→ 修改语句生成 WAL，事务 Commit 刷 WAL
→ DestReceiver/Protocol 编码结果返回
```

### 3.2 Extended Query Protocol {/* #extended-query-protocol */}

JDBC Prepared Statement 常走 Parse → Bind → Execute：Parse 生成命名/匿名 Prepared Statement，Bind 把参数与 Result Format 绑定到 Portal，Execute 驱动 Portal。Generic Plan/Custom Plan 的选择发生在这里相关的计划缓存路径，排查“同一 SQL 有时快有时慢”要同时记录参数、Plan Cache 和协议，而不只看文本。

### 3.3 Planner 与 Executor 的边界 {/* #planner-与-executor-的边界 */}

Planner 不读取每一条业务结果，它根据 Catalog、统计、GUC 和 Cost 枚举 Path，选择 Plan。Executor 把 Plan 节点初始化为 PlanState，按拉取模型生产 Tuple，调用表达式、Access Method、Buffer/Lock。`EXPLAIN` 展示计划；`EXPLAIN ANALYZE` 真正运行 Executor 并收集计数。

### 3.4 UPDATE 再多走哪些路 {/* #update-再多走哪些路 */}

Executor 定位旧 Tuple、检查并发可见性与约束，写新版本/索引，标记 Buffer Dirty，并通过 `src/backend/access/transam` 等路径生成 WAL Record。Commit 使 WAL 达到持久化要求；数据页稍后由 Checkpointer/Background Writer 写回。数据文件先写完不能替代 WAL 先行原则。

## 4. Extension 的三个层级 {/* #extension-的三个层级 */}

| 层级 | 能做什么 | 风险 |
| --- | --- | --- |
| SQL Extension | View、Function、Type、Operator 的 SQL 组合 | 权限、Search Path、升级脚本 |
| PL/pgSQL/可信语言 | 数据库内业务逻辑 | 长事务、动态 SQL、权限边界 |
| C Extension | 新类型、函数、AM、Hook、Background Worker | 数据库进程权限、内存/并发/ABI 崩溃 |

标准 Extension 包通常包含：

```text
myext.control               元数据、default_version、relocatable 等
myext--1.0.sql              CREATE EXTENSION 初始对象
myext--1.0--1.1.sql         升级路径
myext.so                    C 共享库（如果需要）
Makefile / meson.build      PGXS 或构建定义
sql/ expected/              Regression Test
```

`CREATE EXTENSION` 让 Catalog 记录一组对象属于同一 Extension；`ALTER EXTENSION ... UPDATE` 按升级脚本推进。每个已发布版本都要有可达升级路径，升级脚本要可重复测试，不能直接编辑生产 Catalog。

SQL 能完成的需求不要写 C。C 代码运行在 Backend 内，无内存隔离；野指针、错误锁、错误 MemoryContext 和未处理中断都可能影响集群稳定性。

## 5. C Extension 必须理解的内核约定 {/* #c-extension-必须理解的内核约定 */}

- 使用 `palloc/pfree` 和正确的 `MemoryContext`，不要假设普通 `malloc` 会随事务自动清理；
- 用 `PG_TRY/PG_CATCH`、`ereport` 处理错误，并在异常路径释放外部资源；
- 用 `ResourceOwner` 跟踪 Buffer、Lock、File 等需要事务级清理的资源；
- 长循环调用 `CHECK_FOR_INTERRUPTS()`，否则取消、Statement Timeout 和关库可能不响应；
- 访问 Tuple/Catalog 使用公开 Server API 与正确 Snapshot/Lock，不直接猜物理布局；
- Background Worker 正确初始化信号、Latch、数据库连接、事务和退出流程。

同一个函数在不同 Context、并行 Worker、Standby 或 Logical Apply 中可能有不同约束，测试必须覆盖。

## 6. Hook {/* #hook */}

常见 Hook 包括 `planner_hook`、`ExecutorStart/Run/Finish/End_hook`、`ProcessUtility_hook` 和认证 Hook。Hook 是全局函数指针，不是有优先级和隔离的插件总线。

安全链式调用模式是：在 `_PG_init` 保存 Previous Hook，安装自己的 Hook；执行时先/后调用 Previous Hook，若为空再调用 Standard Function；`_PG_fini` 在允许卸载的场景恢复。多个 Extension 的顺序由加载顺序影响，漏调 Previous Hook 会截断别的 Extension，递归调用自己则可能栈溢出。

需要共享内存、LWLock、后台 Worker 或必须在 Backend 很早初始化的扩展通常通过 `shared_preload_libraries` 加载，变更需要重启。只需 Session 加载的功能可评估 `session_preload_libraries` 或显式 `LOAD`，但权限和生命周期要清楚。

Hook 与 Server Header 属于内部 C API，Major 升级必须重新编译、跑测试并审阅行为变化；旧 `.so` 不能直接复制到新 Major。

## 7. 从零构建隔离调试环境 {/* #从零构建隔离调试环境 */}

```bash
git clone https://github.com/postgres/postgres.git
cd postgres
git checkout REL_18_6

./configure --prefix=/opt/pgsql-debug \
  --enable-debug --enable-cassert \
  CFLAGS='-O0 -g3'
make -j"$(nproc)"
make check-world
make install
```

Tag 只是示例，必须换成问题环境的精确版本。Debug/CAssert 构建用于正确性，不代表生产性能；性能 Profile 要用保留符号且优化级别接近生产的构建对照。

初始化独立端口和 data-dir，加载最小测试数据。为目标 Extension 使用 PGXS 编译并运行 `make installcheck`；内核修改还要跑 Regression、Isolation、TAP 和相关模块测试。

## 8. 调试 {/* #调试 */}

### 8.1 断点跟踪一条 SELECT {/* #断点跟踪一条-select */}

在实验实例查出当前 Backend PID，使用 gdb/lldb 设置函数断点：`exec_simple_query`、Planner 入口、`ExecutorStart/Run/End` 和目标 Access Method。每次只追一个最小 SQL，记录调用栈和关键 Node Tag；不要一开始给所有 Tuple 函数打断点。

Extended Protocol 需从 Parse/Bind/Execute 消息分别下断点。若通过连接池，先确保调试连接固定到同一 Backend。

### 8.2 性能分析 {/* #性能分析 */}

用 `perf record -g -p <PID>`、FlameGraph、eBPF/DTrace 和 PostgreSQL 动态 Trace 能力观察 CPU、Off-CPU、Lock 与 I/O；结合 `pg_stat_activity.wait_event`、`pg_stat_io` 和 Query Plan。Debug `-O0` 的函数内联、锁时序和 CPU 比例与 Release 差异很大，不能直接下性能结论。

### 8.3 Crash/Core {/* #crashcore */}

保存 Core、完全匹配的 `postgres`/Extension `.so`、Debug Symbols、Build ID、配置、SQL/参数、日志和 OS/硬件事件。用 `bt full` 定位崩溃线程/进程，再检查最近 Extension/Hook、内存破坏和 Catalog/WAL；不要只凭最后一帧认定根因，内存越界可能早已发生。

不要在生产 attach 后随意断点，也不要加载来源不明的 `.so`。保存 core、二进制、symbols、配置和 WAL 证据。

:::warning
生产 Backend 被断点暂停时可能持有 Lock/LWLock/Buffer Pin，阻塞整个业务甚至 HA。生产优先使用 Core、采样 Profile、日志和动态追踪；需要 Attach 必须有变更审批、超时和 Kill/Failover 预案。
:::

## 9. 源码学习实验 {/* #源码学习实验 */}

1. 对 `SELECT * FROM orders WHERE id = $1` 分别走 Simple 与 Extended Protocol，画出函数链。
2. 用 `EXPLAIN` 比较 Seq Scan/Index Scan，在 Planner 断点观察 Path 到 Plan。
3. 写一个只包含 SQL Function 的 Extension，完成 1.0 → 1.1 升级测试。
4. 写最小 Executor Hook，只记录 Query ID 和耗时，不打印 SQL 参数；同时加载另一个 Hook 验证链式调用。
5. 人为制造 C Extension Error，在 `PG_TRY/PG_CATCH` 前后检查 MemoryContext/ResourceOwner 清理。
6. 在隔离环境生成 Core，用匹配 Symbols 还原 Stack，并写出可复现测试。

完成标准不是“能编译”，而是能解释生命周期、权限、错误清理、并发、Major 兼容和故障影响。

## 10. 验收题 {/* #验收题 */}

- Planner 与 Executor 的源码边界是什么？
- C Extension 为什么等同数据库内核权限？
- Hook 链为何必须调用 previous hook？
- Debug 构建为什么不能代表生产性能？
- Simple Query 与 Extended Query 在哪一层开始分开？
- 为什么 Core 分析必须保留精确匹配的二进制、`.so` 和 Symbols？

## 11. 参考资料 {/* #参考资料 */}

- [PostgreSQL source](https://github.com/postgres/postgres)
- [Extending SQL](https://www.postgresql.org/docs/18/extend.html)
- [Extension Building Infrastructure](https://www.postgresql.org/docs/18/extend-pgxs.html)
- [Regression Tests](https://www.postgresql.org/docs/18/regress.html)
- [Backend Flowchart](https://www.postgresql.org/developer/backend/)
