---
title: "连接池、Prepared Statement、事务、超时与重试"
sidebar_label: "05. 连接池、Prepared Statement、事务、超时与重试"
sidebar_position: 5
tags: [MySQL, 连接池, Prepared Statement, 事务, 超时, 重试]
description: "从应用侧建立安全连接池、参数化 SQL、短事务、分层超时、取消、幂等和有限重试的生产边界。"
---

# 连接池、Prepared Statement、事务、超时与重试

很多数据库事故不是 SQL 语法造成的，而是应用运行策略：连接池总量超过实例能力、事务跨远程调用、超时后数据库仍执行、所有错误都自动重试，最终形成雪崩。

---

## 1. 一次应用请求的资源路径

```text
HTTP 请求
→ 等待应用线程/协程
→ 等待连接池
→ 建立或借用 MySQL 连接
→ 开始事务
→ 执行一条或多条 SQL
→ Commit/Rollback
→ 清理 Session
→ 归还连接
```

用户看到的“数据库耗时”可能包含连接池排队，也可能只记录 SQL 网络往返。每一段都要单独计时。

---

## 2. 为什么使用连接池

连接建立包含 TCP、TLS、认证和 Session 初始化。池化可复用连接、限制数据库并发，并吸收短突发。

连接池不是越大越好：

```text
总潜在连接
= 应用副本数 × 每副本池上限
+ 管理/任务/报表/复制/备份连接
```

例如 100 个 Pod，每池 50，理论上是 5000 个应用连接。实例 `max_connections`、内存和执行能力可能远低于此。

池大小应基于数据库能承受的**活跃并发**与请求时间，而不是应用线程数。

---

## 3. 连接池必须观测什么

- active/idle/total；
- waiters；
- acquire latency P95/P99；
- acquire timeout；
- connection create/close rate；
- validation failures；
- checkout duration；
- 泄漏检测；
- 按应用/租户/功能的连接占用。

若 SQL 很快但 acquire latency 高，瓶颈在应用池或数据库并发容量，不应把这段误归因到某条 SQL。

---

## 4. Session 污染

连接归还前可能残留：

- 未提交事务；
- `autocommit=0`；
- 非默认隔离级别或时区；
- 临时表和用户变量；
- 锁；
- Session SQL Mode；
- Prepared Statement/游标资源。

使用驱动/连接池提供的 reset 机制，并在 checkout 时设置必要基线。不要仅执行一条 `ROLLBACK` 就假设所有 Session 状态已恢复。

---

## 5. Prepared Statement

```text
SELECT id, status
FROM orders
WHERE order_no = ?
```

价值：

- 参数值与 SQL 结构分离，防止值改变语法；
- 驱动正确编码类型；
- 重复执行时可减少部分解析开销；
- 便于稳定 SQL Digest。

它不能参数化表名、列名、关键字和排序方向。动态标识符用白名单映射，不能把用户输入直接拼接。

还要限制单连接 Prepared Statement 数量并正确释放，避免池化长连接持续积累 Server/Client 资源。

---

## 6. 事务边界

事务只包住必须原子完成的数据库步骤：

```text
BEGIN
→ 锁定/校验必要行
→ 修改订单、库存、流水
→ 写 Outbox
→ COMMIT
```

不要在事务内：

- 调用慢 HTTP；
- 等待用户输入；
- 上传文件；
- 发送邮件；
- 运行无界循环；
- 做大批量计算。

这些操作延长持锁和旧版本时间，并把外部抖动传给数据库。

---

## 7. Autocommit 与框架

MySQL 默认常见为 autocommit 开启；每个连接的 Session 状态独立。ORM/驱动可能用 API 控制事务，而不是直接发送 SQL。

代码评审要确认：

- 事务从哪一行真正开始；
- 异常是否 Rollback；
- 连接何时归还；
- DDL 是否触发隐式提交；
- 嵌套事务是 Savepoint 还是框架假象；
- 只读事务是否真的发往正确副本。

不要仅凭注解名称推断数据库实际状态，用 Trace、General/Performance Schema 采样和测试验证。

---

## 8. 四类超时

| 超时 | 保护什么 |
| --- | --- |
| Connect Timeout | DNS/TCP/TLS/认证阶段 |
| Pool Acquire Timeout | 等待可用连接 |
| Query/Statement Timeout | SQL 执行预算 |
| Transaction/Request Deadline | 整个业务操作预算 |

还可能有 Socket Read/Write、Lock Wait、Gateway 和客户端超时。

预算应逐层一致：上层 Deadline 要给下层取消和清理留时间，不能客户端 1 秒放弃而数据库继续执行 5 分钟。

---

## 9. 超时不等于数据库已经停止

客户端超时可能只是停止等待。查询是否被 Server 取消取决于驱动、协议、连接状态和具体超时机制。

风险：

```text
客户端认为失败
→ 自动重试同一写入
→ 原 SQL 实际已提交
→ 产生重复订单/扣款
```

必须结合：

- Server 端执行/锁超时；
- 驱动取消；
- 连接关闭与复用安全；
- 幂等键/唯一约束；
- 最终状态查询。

---

## 10. 哪些错误可以重试

### 可能瞬时且可重试

- Deadlock victim；
- 短暂连接中断；
- 故障切换后的连接失败；
- 明确的锁等待超时（需评估业务）。

### 通常不能盲目重试

- SQL 语法/列不存在；
- 权限拒绝；
- 约束冲突；
- 数据超范围；
- 磁盘满；
- 查询长期超时；
- 事务结果未知且操作非幂等。

重试必须按错误码/SQLSTATE 分类，而不是捕获 Exception 后统一循环。

---

## 11. 重试策略

```text
有限次数
+ 指数退避
+ 随机抖动
+ 总 Deadline
+ 幂等保护
+ 重试指标
+ 过载时快速失败
```

死锁重试应重放**整个事务**，因为事务已被回滚；不能只重发最后一条 SQL。

重试会放大负载。数据库已经过载时，无退避重试可能把一次失败变成持续雪崩。

---

## 12. 幂等写

使用稳定业务键和唯一约束：

```sql
CREATE TABLE payment_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(64) NOT NULL,
  status TINYINT UNSIGNED NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_idempotency (idempotency_key)
) ENGINE=InnoDB;
```

重复请求到达时：

- 相同 Key + 相同参数：返回已存在结果；
- 相同 Key + 不同参数：拒绝冲突；
- 不确定事务结果：按 Key 查询状态，而不是直接创建新请求。

幂等记录需要生命周期和容量规划。

---

## 13. 读写分离的一致性

写 Source 后立刻读 Replica 可能因复制延迟读不到刚提交数据。

策略：

- Read-your-writes 时间窗内读 Source；
- 携带 GTID/位置等待 Replica 追上；
- 关键流程固定主库；
- 明确哪些查询允许陈旧；
- 故障时不要把延迟 Replica 误提升。

连接池要区分读写角色，故障切换后清理旧连接和 Prepared State。

---

## 14. 连接风暴与过载保护

实例重启或网络恢复后，大量 Pod 同时重连：

```text
连接风暴
→ TLS/认证/线程压力
→ 正常查询更慢
→ 更多超时和重试
```

保护：

- 客户端连接退避和抖动；
- 每实例连接预算；
- 应用启动分批；
- 池最小连接不要瞬间全预热；
- 管理连接预留；
- Proxy 也要有有界队列；
- Readiness 在数据库不可用时避免无限自旋。

---

## 15. 可观测链路

一次请求至少关联：

```text
request_id / trace_id
pool_wait
connection_create_or_reuse
transaction_start/end
SQL digest（不记录敏感字面值）
server execution/lock wait
commit
rows affected/returned
retry count and reason
```

Metrics 用低基数聚合；Trace 记录抽样路径；日志不要输出完整密码、Token、身份证、SQL 参数和敏感结果。

---

## 16. 容量一致性检查

用 Little 定律做池大小初估：

```text
平均活跃并发 ≈ 到达率 × 平均数据库占用时间
```

最终以 P95/P99、突发、长事务和数据库 SLO 压测校准。

全局约束：

```text
Σ(所有应用副本池上限)
不应无控制地远大于数据库连接与活跃执行预算
```

可以让等待发生在应用有界连接池，而不是让数据库接收无限活跃查询后整体失控。

---

## 17. 故障实验

1. 把池上限设得很小，观察 acquire latency 与超时；
2. 开事务后模拟异常，验证连接归还前 Rollback/Reset；
3. 让两个事务死锁，验证仅重试整个事务且次数有限；
4. 模拟客户端超时，确认 Server 查询是否仍运行；
5. 使用幂等键重复提交写请求；
6. 重启实验实例，观察带抖动和无抖动重连的差异；
7. 写 Source、读延迟 Replica，验证一致性策略。

## 18. 验收题

1. 连接池为什么既复用连接又限制并发？
2. 怎样计算所有 Pod 对数据库的潜在连接总量？
3. Prepared Statement 能和不能参数化什么？
4. 为什么事务内不应调用外部慢服务？
5. 客户端超时为什么不代表写入一定失败？
6. 死锁后为什么应重试整个事务？
7. Read-after-write 为什么可能在 Replica 读不到？
8. 如何防止数据库恢复时的连接风暴？

完成本模块后，下一阶段进入 InnoDB 内核：内存、磁盘、Page、Buffer Pool、Redo、Undo、MVCC、锁和崩溃恢复。

## 官方参考

- [Prepared Statements](https://dev.mysql.com/doc/refman/8.4/en/sql-prepared-statements.html)
- [START TRANSACTION, COMMIT, ROLLBACK](https://dev.mysql.com/doc/refman/8.4/en/commit.html)
- [Connection Interfaces](https://dev.mysql.com/doc/refman/8.4/en/connection-interfaces.html)
- [InnoDB Error Handling](https://dev.mysql.com/doc/refman/8.4/en/innodb-error-handling.html)
