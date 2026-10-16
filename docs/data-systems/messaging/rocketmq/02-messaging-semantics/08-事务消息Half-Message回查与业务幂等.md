---
title: "事务消息、Half Message、回查与业务幂等"
sidebar_label: "08. 事务消息、Half Message、回查与业务幂等"
sidebar_position: 8
description: "理解 RocketMQ 事务消息 Half、提交/回滚、状态回查和最终一致性边界。"
tags: [RocketMQ, Transaction Message, Idempotency]
---

# 事务消息、Half Message、回查与业务幂等

RocketMQ 事务消息解决的是“本地数据库事务已经确定，但普通消息发送结果可能不一致”的问题。它把消息先保存为消费者不可见的中间状态，再依据本地事务结果决定提交或回滚，目标是最终一致，不是跨数据库的分布式 ACID。

## 1. 完整状态机

```text
Producer                         Broker                         Consumer
   │ send half message             │                               │
   ├───────────────────────────────>│ store as transaction pending  │
   │<──────────── half ACK ─────────┤                               │
   │ execute local DB transaction  │                               │
   │                               │                               │
   ├──── COMMIT / ROLLBACK ────────>│                               │
   │                               ├─ COMMIT → Ready ──────────────>│
   │                               └─ ROLLBACK → terminate          │

if second ACK is missing/UNKNOWN:
Broker ── transaction check ──> any healthy producer/checker in group
       <── COMMIT / ROLLBACK / UNKNOWN based on durable business state
```

Half Message 已被 Broker 接收并处于事务待决状态，但普通消费者不可见。它不能被理解为“只存在 Producer 内存中”。

## 2. 为什么普通先后顺序不能解决双写

### 2.1 先提交数据库，再发普通消息 {/* #先提交数据库再发普通消息 */}

```text
DB COMMIT success
→ process crashes before send
→ business exists but event is absent
```

### 2.2 先发普通消息，再提交数据库 {/* #先发普通消息再提交数据库 */}

```text
message visible to consumer
→ local DB rolls back
→ downstream acts on a business fact that never existed
```

事务消息把第二个动作从“发送普通可见消息”改成“提交待决消息”，并由 Broker 回查弥补第二 ACK 丢失窗口。

## 3. Producer 端必须有权威事务状态

回查不能依赖内存变量、线程状态或一条普通日志。推荐在业务数据库中持久化可判断的状态：

```sql
CREATE TABLE message_transaction (
  event_id        VARCHAR(64) PRIMARY KEY,
  business_key    VARCHAR(128) NOT NULL,
  business_state  VARCHAR(32) NOT NULL,
  event_type      VARCHAR(64) NOT NULL,
  schema_version  INTEGER NOT NULL,
  tx_state        VARCHAR(16) NOT NULL,
  updated_at      TIMESTAMP NOT NULL
);
```

在同一个本地数据库事务中完成业务修改与事务状态记录：

```text
BEGIN
→ verify current business version
→ update order/payment state
→ insert/update message_transaction(event_id, tx_state=COMMITTED)
COMMIT
```

回查只根据持久化结果：

| 数据库状态 | 回查返回 | 说明 |
| --- | --- | --- |
| 明确已提交 | COMMIT | 即使原 commit message 丢失也可恢复 |
| 明确回滚/业务不存在且已终结 | ROLLBACK | 不应投递 |
| 事务仍执行或无法判断 | UNKNOWN | 等待后续回查，但必须有上限 |

“查询不到记录”不一定等于 ROLLBACK：也可能是数据库不可达、复制延迟或事务仍在执行。回查程序必须区分明确不存在与查询失败。

## 4. 本地事务执行必须幂等

Producer 可能因为应用重试或网络不确定再次走发送流程。使用稳定 `event_id` 和业务版本：

- 相同 event_id 再执行，不重复扣款/建单；
- 已处于目标状态时返回已提交；
- 旧版本事件不得覆盖新状态；
- 并发请求通过唯一约束或 CAS 收敛；
- 回查只读权威状态，不重新执行本地事务。

事务 checker 可能被并发、重复调用，也可能由 Producer group 中另一个实例处理，所以不能依赖最初发送实例的本地文件或缓存。

## 5. 七个异常窗口

| 异常点 | Broker/业务状态 | 恢复路径 |
| --- | --- | --- |
| Half 发送失败 | Broker 未确认，业务未开始 | 不执行本地事务，按策略重试 |
| Half 成功后进程崩溃 | 消息待决，业务可能未开始 | 回查权威状态 |
| 本地事务回滚 | 待决 + 业务未提交 | 发送 ROLLBACK |
| 本地提交，COMMIT 丢失 | 待决 + 业务已提交 | 回查返回 COMMIT |
| 回查时数据库不可达 | 无法判断 | UNKNOWN + 告警，不能猜测 |
| 回查长期 UNKNOWN | 大量待决消息 | 达到时间/次数边界后人工补偿 |
| 消费提交后 ACK 丢失 | 消息已可见且业务已处理 | 消费端幂等吸收重复 |

要特别监控 Half 数量、最老待决年龄、回查 QPS/耗时/UNKNOWN 比例和最终强制回滚。大量 UNKNOWN 会让 Broker 和 Producer checker 都承压。

## 6. Consumer 仍然必须幂等

事务消息只保证“本地事务提交后，消息最终可见”。进入普通消费状态后，网络、ACK 丢失、Rebalance 和重试仍可能重复投递。

下游常用状态机：

```text
event_id unique constraint
+ business_key aggregate version
+ business change in same local DB transaction
→ then ACK
```

不能把“事务消息”宣传成端到端 exactly-once。

## 7. 与 Outbox/CDC 的选择

| 维度 | RocketMQ 事务消息 | Transactional Outbox + Relay/CDC |
| --- | --- | --- |
| 权威状态 | 业务库 + Broker 待决状态，Broker 主动回查 | 业务库 outbox 行 |
| 业务事务 | 执行于 Half ACK 之后 | 与 outbox 写入同一 DB 事务 |
| 恢复方式 | Transaction Checker | 扫描/CDC 重发未发布行 |
| 中间件耦合 | 较强，需要事务 SDK | 较弱，可更换消息系统 |
| 可审计重放 | 需设计事务日志 | outbox 天然可查询 |
| 运维压力 | Half/回查/Producer 可用性 | outbox 清理、relay lag、CDC |

如果团队已有可靠 CDC 和 Outbox 治理，Outbox 往往更容易审计；若希望利用 RocketMQ 原生回查且业务能稳定查询事务状态，可选择事务消息。不要在同一业务事件上同时使用两套机制而没有唯一权威状态。

## 8. Topic 与版本约束

RocketMQ 5.x 事务消息只能发往 Transaction 类型 Topic：

```bash
sh bin/mqadmin updateTopic \
  -n nameserver-1:9876 \
  -c prod-cluster \
  -t order-transaction \
  -a +message.type=Transaction
```

事务 Producer 还需要预绑定 Topic 和 Transaction Checker。4.x 与 5.x SDK 的 API、Producer Group 与配置边界不同，迁移前要建立 Broker/Proxy/SDK 兼容矩阵。

## 9. 事务超时与回查参数

回查间隔过短会在正常慢事务尚未完成时制造大量 UNKNOWN；过长则延长事件最终可见时间。最大回查次数/总超时决定系统能容忍多久的不确定状态。

参数设计以数据为依据：

```text
first_check_delay > local_transaction_p99 + safety_margin
total_check_window > expected dependency recovery time
but < business compensation deadline
```

官方默认值会随版本和实现变化，必须从目标 5.5.0 配置、参数限制与源码确认，不能复制旧 4.x 数字。

## 10. 事务消息 Runbook

### 10.1 Half/待决数量持续增长 {/* #half待决数量持续增长 */}

1. 判断是业务流量增长还是 Commit/回查失败；
2. 检查 Producer checker 实例是否在线、Topic 是否预绑定；
3. 检查业务数据库查询 P99、连接池和复制一致性；
4. 统计 COMMIT/ROLLBACK/UNKNOWN 比例及异常；
5. 保护数据库，限制新事务消息流量，避免回查风暴；
6. 不直接删除待决消息；先按 event_id 与业务库对账。

### 10.2 已提交业务但下游没有事件 {/* #已提交业务但下游没有事件 */}

沿 event_id 检查：Half receipt → 本地事务记录 → second ACK → 回查日志 → Broker 消息状态 → Consumer Group。确认仍在回查窗口内，不能通过再造一个随机 ID 的普通消息掩盖原事务。

### 10.3 下游出现重复业务 {/* #下游出现重复业务 */}

检查 Consumer 幂等表/唯一约束，而不是把原因全部归咎于事务 Producer。提交 ACK 丢失也会产生合法重投。

## 11. 最小故障实验

1. Half 成功后、执行数据库前杀进程；
2. 数据库提交后、发送 COMMIT 前杀进程；
3. 回查期间让数据库短暂不可达，验证返回 UNKNOWN；
4. 恢复后确认同一 event_id 最终只形成一次业务状态转移；
5. 让 Consumer 提交业务后不 ACK，验证下游幂等；
6. 制造长期 UNKNOWN，验证告警、限流和人工补偿；
7. 对账本地事务表、Broker 事务状态、普通可见消息和消费结果。

## 12. 验收题

- Half Message 为什么消费者不可见？
- 回查依据应存在哪里？
- 事务消息为何仍会重复消费？
- Outbox 与事务消息的权威状态分别在哪里？
- 查询不到事务记录时为什么不能总是返回 ROLLBACK？
- 回查为什么可能落到另一个 Producer 实例？
- 回查窗口应怎样与本地事务 P99、依赖恢复和业务补偿期限关联？
- 哪几个阶段都需要 event_id 幂等？

## 13. 参考资料

- [事务消息](https://rocketmq.apache.org/docs/featureBehavior/04transactionmessage/)
- [RocketMQ 参数限制与建议](https://rocketmq.apache.org/docs/introduction/03limits/)
