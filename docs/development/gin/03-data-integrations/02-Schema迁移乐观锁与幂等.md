---
title: "Gin 数据模型、Schema 迁移、乐观锁与幂等提交"
sidebar_label: "02. Gin 数据模型、Schema 迁移、乐观锁与幂等提交"
sidebar_position: 2
description: "CRUD 的难点往往不在语法，而在并发、重复请求和版本演进。唯一约束、条件更新与迁移窗口共同决定数据是否可靠。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 数据模型、Schema 迁移、乐观锁与幂等提交

CRUD 的难点往往不在语法，而在并发、重复请求和版本演进。唯一约束、条件更新与迁移窗口共同决定数据是否可靠。

## 1. 任务表中的不变量

tasks 用 tenant+request_key 唯一约束控制重复创建，用 state+version 约束允许的状态转换。相同幂等键和相同名称返回原 Task，相同键不同名称返回冲突，不能默默覆盖。

条件更新把“检查状态”和“写入状态”放在数据库原子边界：取消只允许 tenant、ID、version 匹配且 state=NEW。RowsAffected=0 后区分不存在与状态冲突，避免先查再改的竞态。

## 2. 验证重复与并发

```bash
cd examples/gin/service-lab
go test ./internal/store -run 'TestCreateIdempotency|TestConcurrentIdempotency|TestCancel' -count=1 -v -timeout=30s
```

服务端不能用内存 Map 去重替代数据库唯一约束，因为重启或多副本后失效。自动增长 ID 或随机 ID 解决身份分配，不解决同一业务请求的重复创建。

## 3. 迁移不是每副本自动建表

service-lab 的 Open 为隔离实验执行 CREATE TABLE IF NOT EXISTS，便于第一遍运行；这不是生产迁移框架，也不会检查已有字段的类型和索引是否正确。

真实系统需要版本化迁移脚本、校验、互斥执行与回滚/前滚策略。先扩展兼容列与索引，再部署兼容读写代码，完成回填和校验，最后收缩旧字段。大表 DDL 的锁和 I/O 成本必须单独验证。

## 4. SQLite 与 PostgreSQL 的差异

SQLite 适合本地实验与特定嵌入式场景，不代表高写并发生产数据库。工程为其限制单连接；跨进程仍可能出现写锁等待，WAL 和 busy_timeout 不是无限并发承诺。

PostgreSQL 走 pgx 驱动，占位符、锁与事务错误语义不同。代码只对自己固定 SQL 做 ? 到 $n 转换，不是通用 SQL 解析器。必须运行显式 PostgreSQL 契约测试后才能声称目标数据库已验证。

## 5. 练习与答案

### 5.1 幂等键冲突但正文不同可以返回同一个成功吗

应按明确契约处理，本项目返回冲突。

### 5.2 version 条件更新能替代先查再改吗

可将并发检查纳入原子更新，仍需解释受影响行数。

### 5.3 IF NOT EXISTS 能检查现有 schema 正确吗

不能，需真正的迁移和校验机制。

## 6. 参考资料

- [SQL 幂等实现源码](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab/internal/store)
- [PostgreSQL 并发控制](https://www.postgresql.org/docs/current/mvcc.html)
