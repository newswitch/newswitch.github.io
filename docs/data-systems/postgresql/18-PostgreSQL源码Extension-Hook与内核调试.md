---
title: "PostgreSQL 源码、Extension、Hook 与内核调试"
sidebar_position: 18
tags: [PostgreSQL, 源码, Extension, Hook, Debug]
description: "从 postmaster/backend、Parser/Planner/Executor 到存储/WAL，并理解扩展与 Hook 边界。"
---

# PostgreSQL 源码、Extension、Hook 与内核调试

## 源码地图

```text
src/backend/postmaster  process lifecycle
src/backend/parser      parse/analyze
src/backend/optimizer   planner
src/backend/executor    executor
src/backend/access      heap/index/transam
src/backend/storage     buffer/lock/lmgr
src/backend/utils       catalog/cache/GUC
src/include             public internal headers
```

追一条 SQL：客户端协议 → Backend main loop → `exec_simple_query`/extended protocol → parse/analyze/rewrite → planner → `ExecutorStart/Run/Finish/End` → access method → buffer manager → WAL。

## Extension

Extension 通过 control/SQL/共享库打包类型、函数、操作符、索引访问方法和后台 worker。升级脚本必须保持对象版本路径；C 扩展运行在数据库进程内，崩溃和内存错误可带倒整个实例。

## Hook

Planner、Executor、ProcessUtility、authentication、shared_preload 等 Hook 允许插入行为，但顺序、链式调用、ABI 和大版本兼容由扩展负责。`shared_preload_libraries` 变更通常需重启。

## 调试

使用固定 tag 的 `--enable-debug --enable-cassert` 构建，在隔离实例以 gdb/lldb 跟踪；配合 regression tests、TAP、`make check-world`。性能分析使用 perf/flamegraph，与 Release 构建对比。

不要在生产 attach 后随意断点，也不要加载来源不明的 `.so`。保存 core、二进制、symbols、配置和 WAL 证据。

## 验收题

- Planner 与 Executor 的源码边界是什么？
- C Extension 为什么等同数据库内核权限？
- Hook 链为何必须调用 previous hook？
- Debug 构建为什么不能代表生产性能？

## 参考资料

- [PostgreSQL source](https://github.com/postgres/postgres)
- [Extending SQL](https://www.postgresql.org/docs/18/extend.html)
