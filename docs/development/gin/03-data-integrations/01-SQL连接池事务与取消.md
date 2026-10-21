---
title: "Gin 与 database/sql：连接池、事务、Rows 关闭与取消"
sidebar_label: "01. Gin 与 database/sql：连接池、事务、Rows 关闭与取消"
sidebar_position: 1
description: "数据库慢不一定是 SQL 慢，也可能是在等连接。理解 sql.DB、事务与 Context 的边界，才能正确处理超时、回滚和容量。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 与 database/sql：连接池、事务、Rows 关闭与取消

数据库慢不一定是 SQL 慢，也可能是在等连接。理解 sql.DB、事务与 Context 的边界，才能正确处理超时、回滚和容量。

## 1. DB 不是一条连接

sql.DB 是并发安全的连接池句柄，Query/Exec 可能先等待池中资源，再使用驱动连接。MaxOpenConns 限制活动连接总量，MaxIdleConns 管理空闲，ConnMaxLifetime 控制复用寿命；不应在每请求重新 Open。

事务会在生命周期内占用连接。池很小时，在事务未结束前又调用 DB.Query，可能等不到空闲连接；事务内的操作应使用 tx。Rows 必须 Close，并检查遍历后的 Rows.Err。

## 2. 本工程的事务范围

创建任务和插入 Outbox 处于同一事务；取消任务也在条件更新成功后同事务写入事件。任一失败都回滚，避免业务已创建但事件永远丢失。

BeginTx 后立即 defer Rollback，成功时 Commit。Rollback 在已提交后返回的状态通常可按具体路径处理，但 Commit 错误不能当作普通输入失败；网络中断时提交结果可能未知，需要幂等查询确认。

## 3. 失败注入实验

```bash
cd examples/gin/service-lab
go test ./internal/store -run 'TestRollbackOutboxFailure|TestInboxFailureRollsBackDedup' -count=1 -v -timeout=30s
```

第一类测试通过 SQLite trigger 拒绝 Outbox 插入，再查询任务不存在；第二类拒绝通知落库，验证 Inbox 也没有留下“已处理”标记。它们证明本机事务不变量，不代表 PostgreSQL 的网络提交失败已验证。

## 4. 池与取消观测

将 Request.Context 传入 QueryContext、ExecContext、BeginTx。超时会影响等待与执行，实际中断行为也取决于驱动；不能把 Context 取消当作数据库所有副作用必然消失。

观察 DB.Stats 的 InUse、Idle、WaitCount/WaitDuration 增量，再看事务时间和数据库本身的锁、慢查询。服务扩容后总池容量是副本数乘每副本上限，要与数据库全局预算共同规划。

## 5. 练习与答案

### 5.1 sql.DB 是一条长连接吗

不是，它管理连接池。

### 5.2 Query 返回 Rows 后可以不 Close 吗

不能，可能长期占用连接等资源。

### 5.3 Commit 超时一定没有提交吗

不能断言，需要按幂等与确认机制处理未知结果。

## 6. 参考资料

- [database/sql](https://pkg.go.dev/database/sql)
- [事务使用](https://go.dev/doc/database/execute-transactions)
