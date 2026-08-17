---
title: "Online DDL、Metadata Lock 与 Schema 变更"
sidebar_label: "04. Online DDL、Metadata Lock 与 Schema 变更"
sidebar_position: 4
tags: [MySQL, Online DDL, MDL, ALTER TABLE, Schema变更]
description: "理解 INSTANT、INPLACE、COPY、Metadata Lock 和长事务，建立可观察、可停止、可回滚的生产 Schema 变更流程。"
---

# Online DDL、Metadata Lock 与 Schema 变更

“Online DDL”不等于“零锁、零 I/O、零影响”。即使允许并发 DML，操作开始或结束阶段仍可能需要 Metadata Lock；长事务会让一个看似简单的 `ALTER TABLE` 排队，并进一步阻塞后续业务请求。

---

## 1. DDL 改变的不只是列

一次 `ALTER TABLE` 可能消耗：

- MDL；
- CPU 和磁盘 I/O；
- 临时空间；
- Buffer Pool；
- Redo/Binlog；
- Replica 回放能力；
- 连接和锁等待队列；
- 备份与恢复窗口。

评审必须包含表大小、写入率、最长事务、磁盘余量、复制拓扑和回滚策略。

---

## 2. 三类算法心智模型

### INSTANT

主要修改元数据，通常最快，但仅部分操作和条件支持。元数据操作仍需要锁，且历史演进可能影响后续表重建。

### INPLACE

尽量在原表结构上完成，可能重建表或索引；不同操作对并发 DML 支持不同。

### COPY

创建新表结构、复制数据并切换，通常时间、I/O、临时空间和阻塞风险最大。

具体支持矩阵随操作和版本变化，执行前查目标 8.4.x 官方 Online DDL 表，而不是凭“加列都是 INSTANT”判断。

---

## 3. 显式声明期望算法

实验示例：

```sql
ALTER TABLE shop.orders
  ADD COLUMN source VARCHAR(32) NULL,
  ALGORITHM=INSTANT;
```

显式算法的价值是：若环境不支持，语句失败，而不是意外退化到代价更高路径。

同理可根据操作声明 `LOCK` 要求。语法成功前仍需在生产规模副本验证，并保存 `SHOW CREATE TABLE` 前后差异。

---

## 4. Metadata Lock

查询访问表时会持有相应 MDL，保护对象定义在语句/事务期间不被不兼容修改。

典型事故：

```text
Session A：开启事务，查询 orders，长时间不提交
Session B：ALTER TABLE orders，等待独占 MDL
Session C...N：新查询排在等待 DDL 后面
→ 连接堆积、业务延迟暴涨
```

真正根因可能是 Session A 的长事务，而告警表面显示大量普通查询等待。

---

## 5. 找出 MDL 等待

```sql
SELECT
  object_schema,
  object_name,
  lock_type,
  lock_duration,
  lock_status,
  owner_thread_id
FROM performance_schema.metadata_locks
WHERE object_schema = 'shop'
  AND object_name = 'orders';
```

再关联线程、当前语句和事务。不要只 Kill 等待 DDL；如果 DDL 已经挡住后续队列，取消它可能缓解业务，但仍需处理真正的长事务。

Kill 前评估事务回滚量、业务所有者、复制/备份任务和故障影响。

---

## 6. 长事务为什么危险

长事务可能：

- 持有 MDL 和行锁；
- 保留 Undo 旧版本；
- 阻止 Purge；
- 让 DDL 无法完成；
- 放大崩溃恢复和回滚时间；
- 造成复制和备份一致性压力。

```sql
SELECT
  trx_id,
  trx_mysql_thread_id,
  trx_started,
  trx_state,
  trx_rows_locked,
  trx_rows_modified,
  trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

空闲连接也可能处于未提交事务，不能只看当前 SQL。

---

## 7. 变更前检查

```text
[ ] 实例、Schema、表和版本
[ ] SHOW CREATE TABLE 与期望差异
[ ] 表数据/索引大小、行数和增长
[ ] 操作支持的 Algorithm/Lock
[ ] 长事务、MDL 和活跃 DML
[ ] Source/Replica 延迟与容量
[ ] 磁盘和临时空间
[ ] 备份、PITR 与回滚路径
[ ] 应用新旧 Schema 兼容
[ ] 低峰窗口、超时、停止阈值和负责人
```

只检查 `SELECT COUNT(*)` 不足以评估 DDL。

---

## 8. Expand/Contract 迁移

需要应用协同的变更采用兼容步骤：

```text
Expand：先增加新列/新表，旧应用仍可运行
→ 应用双读/双写或回填
→ 校验新旧数据
→ 切换读路径
→ 停止旧写
→ Contract：等待回滚窗口后删除旧结构
```

每一步都必须：

- 可观测；
- 可暂停；
- 明确 Source of Truth；
- 有数据校验；
- 旧版本应用不会被新 Schema 破坏。

删除/重命名列不应和首次应用切换同一时刻完成。

---

## 9. 回填不是一条大 UPDATE

大回填会制造长事务、锁、Redo/Binlog、复制延迟和脏页压力。

安全策略：

- 按主键范围小批处理；
- 每批提交；
- 幂等条件只更新缺失数据；
- 限制速率；
- 观察 P99、锁、Redo、磁盘和 Replica Lag；
- 保存断点；
- 可停止并继续。

完成后按总量、分桶、异常样本和业务校验和验证，而不是只看脚本退出码。

---

## 10. 外键和索引变更

构建索引会扫描数据、排序和写入新结构。添加外键还要处理历史数据、父子表关系和在线 DDL 限制。

删除索引前：

- 检查查询与外键依赖；
- 覆盖足够长业务周期；
- 评估优化器是否使用；
- 可先使用 Invisible Index 做风险实验（不适用于主键等边界）；
- 准备快速恢复定义。

“监控一周没用”不代表月末/季度任务不需要。

---

## 11. 第三方 Online Schema 工具

影子表 + Trigger/复制变更 + 原子切换类工具能降低部分阻塞，但会引入：

- 额外写放大和空间；
- Trigger/外键限制；
- 复制与切换复杂性；
- 工具权限与失败恢复；
- 大量小批复制对生产的持续压力。

工具不是“无锁按钮”。采用前固定版本、理解算法、在生产规模演练，并定义中止后的清理与恢复。

---

## 12. 变更期间看什么

```text
业务 QPS、错误、P95/P99
Threads_connected/running
MDL 与行锁等待
DDL 进度（支持时）
CPU、IOPS、吞吐、await、磁盘空间
Redo/Binlog 速率
Buffer Pool 脏页和刷盘
Replica Lag 与回放线程
备份任务状态
```

停止阈值在执行前写好。等业务已经不可用再讨论阈值没有意义。

---

## 13. DDL 与事务

许多 DDL 会触发隐式提交，不能假设：

```sql
START TRANSACTION;
ALTER TABLE ...;
ROLLBACK;
```

可以像普通 DML 一样回滚 Schema。执行前查“Statements That Cause an Implicit Commit”，并在隔离环境验证。

原子 DDL 改善的是 Server 在故障时对数据字典和存储引擎变更的一致处理，不等于业务可以任意撤回已经完成的变更。

---

## 14. 演练

1. 会话 A 开事务查询表并保持不提交；
2. 会话 B 执行测试 DDL；
3. 会话 C 再查询同表；
4. 用 `metadata_locks`、`threads`、`innodb_trx` 画等待链；
5. 取消 DDL并观察业务恢复；
6. 提交/回滚长事务后重试；
7. 在不同数据量比较 INSTANT、INPLACE 与 COPY 的时间和 I/O；
8. 设计一次 Expand/Contract 与分批回填。

仅在实验实例执行阻塞演练。

## 15. 验收题

1. Online DDL 为什么仍可能阻塞业务？
2. INSTANT、INPLACE、COPY 的核心差异是什么？
3. 为什么显式声明 Algorithm 能降低意外风险？
4. DDL 等待时怎样找到真正阻塞者？
5. 回填为什么要按主键分批并可续跑？
6. Expand/Contract 如何保护新旧应用兼容？
7. 为什么第三方 Online Schema 工具仍需容量和恢复演练？

下一篇把 Schema 与应用运行时连接起来：连接池、Prepared Statement、事务、超时和重试。

## 官方参考

- [InnoDB Online DDL](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl.html)
- [Online DDL Operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)
- [Metadata Locking](https://dev.mysql.com/doc/refman/8.4/en/metadata-locking.html)
- [Statements That Cause an Implicit Commit](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)
