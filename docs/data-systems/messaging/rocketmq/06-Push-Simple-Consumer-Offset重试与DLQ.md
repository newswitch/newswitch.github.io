---
title: "Push/Simple Consumer、Offset、负载均衡与重试 DLQ"
sidebar_label: "06. Push/Simple Consumer、Offset、负载均衡与重试 DLQ"
sidebar_position: 6
description: "理解消费模式、Queue 分配、确认、重复、重试和死信治理。"
tags: [RocketMQ, Consumer, Offset, Retry, DLQ]
---

# Push/Simple Consumer、Offset、负载均衡与重试 DLQ

消息“成功写入 Broker”只完成一半。Consumer 还要管理分配、拉取、缓存、业务事务、确认、重试与死信。RocketMQ 通常提供至少一次投递语义，应用必须把重复当作正常路径。

## 1. 两类 5.x Consumer 怎么选

| 能力 | PushConsumer | SimpleConsumer |
| --- | --- | --- |
| 获取消息 | SDK 内部长轮询并回调应用 | 应用显式 `receive` |
| 并发 | SDK 线程与本地缓存管理 | 应用自己调度线程/批次 |
| 成功确认 | Listener 返回成功 | 应用显式 `ack` |
| 失败重试 | 失败状态进入 WaitingRetry | 不 ACK，InvisibleDuration 到期重投 |
| 处理时间 | 适合可预测、较短回调 | 适合耗时不确定或需主动延长不可见时间 |
| 流控 | 调整 SDK 缓存/线程 | 应用控制 receive 频率和批量 |

PushConsumer 名称中的 Push 不代表 Broker 主动向任意端口推送；SDK 内部仍管理取消息过程。经典 4.x PullConsumer 与 5.x API 不应混为一谈。

## 2. 一条消息的消费状态机

```text
Group assignment → fetch Queue offset
→ Ready
→ Inflight / local cache
→ business handler
   ├─ success → Commit/ACK，进度向前
   └─ failure/timeout → WaitingRetry 或等待再次可见
                          └─ 超过最大次数 → DLQ
```

若最大重试次数为 3，通常表示首次投递之外再重试 3 次，即最多可能处理 4 次。具体行为要以 Consumer 类型、Group 元数据和目标版本为准。

## 3. ACK 与业务事务的两个崩溃窗口

### 3.1 先 ACK，后提交业务 {/* #先-ack后提交业务 */}

```text
ACK success → process crashes → database not committed
```

Broker 认为已消费，业务结果丢失。这是不可接受的顺序。

### 3.2 先提交业务，后 ACK {/* #先提交业务后-ack */}

```text
database committed → ACK lost/process crashes → message redelivered
```

业务不会丢，但会重复。因此可靠消费者应先完成幂等业务事务，再确认消息。

常见幂等实现：

```sql
BEGIN;

INSERT INTO consumed_event(event_id, consumer_name, consumed_at)
VALUES (:event_id, 'inventory-service', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- 只有首次插入时才执行库存状态转移；
-- 或使用业务版本号条件更新。

COMMIT;
```

SQL 只是模式示意，实际要确保幂等记录和业务修改处于同一事务。不能先写 Redis 去重键、再改数据库却没有原子关系。

## 4. Offset 表示什么

Queue 有 Broker 最大 offset，Consumer Group 对每个 Queue 有消费进度。简化理解：

```text
lag(queue) = broker_max_offset - consumer_offset
```

但 Offset 差只表示条数，不代表等待时间和处理成本。排障必须同时看：

- 总 lag 和各 Queue lag；
- 最老未消费消息年龄；
- 当前生产/消费速率；
- 重试与 DLQ 速率；
- 单消息处理 P99；
- 消费者实例、Queue 分配和本地缓存。

重置 offset 是业务重放操作，不是“清告警”按钮。回退会再次触发所有副作用；向前跳会主动放弃消息。必须审批、暂停/隔离 Group、记录目标时间/offset、验证保留窗口并准备幂等和回滚。

只读查询示例：

```bash
sh bin/mqadmin consumerProgress \
  -n nameserver-1:9876 \
  -g prod.inventory.reserve-stock

sh bin/mqadmin consumerStatus \
  -n nameserver-1:9876 \
  -g prod.inventory.reserve-stock
```

使用目标 release 的 `mqadmin help` 核对命令与参数。

## 5. Queue 分配与 Rebalance

同一 Group 中，Queue 会分配给不同 Consumer 实例。实例加入、退出、心跳超时或订阅变化可能触发 Rebalance：

```text
old owner stops pulling / drains local process queue
→ assignment recalculated
→ new owner starts from committed progress
```

若旧实例已完成业务但进度尚未提交，新实例可能再次处理。若旧实例未正确停止仍继续写业务，还可能并发处理。因此需要：

- 实例 ID 和订阅配置稳定；
- 先摘流量，再停止拉取并排空本地处理；
- 限制单消息/单批处理时间；
- 观测 Rebalance 次数和持续时间；
- 不频繁弹性伸缩几秒级任务；
- 同一 Group 的投递顺序与重试策略保持一致。

Consumer 实例数超过 Queue 数通常没有有效并行收益；但只增加 Queue 也不能解决数据库已满、单热 Key 或毒消息阻塞。

## 6. PushConsumer 的本地缓存

PushConsumer 会把一批消息放入 SDK 本地缓存再交给线程。缓存过大：

- 消耗 Heap/Direct Memory；
- 进程崩溃时重投批量增大；
- Broker lag 看似下降，但业务尚未完成；
- 长处理导致超时和重复。

缓存过小又会降低吞吐。应把“Broker 等待、SDK 本地等待、业务执行”分段观测，而不是只看 listener 耗时。

## 7. SimpleConsumer 的 InvisibleDuration

`receive(batch, invisibleDuration)` 获取消息后，消息在该时间内对其他处理不可见：

```text
receive at T0
→ must ack before T0 + InvisibleDuration
→ otherwise message becomes available for retry
```

InvisibleDuration 应略大于正常处理 P99 加网络/提交余量，但不能无限大：过短导致并发重复，过长会拖慢真正故障后的恢复。任务确实需要更久时，在尚未超时且未 ACK 前使用 SDK 支持的 `ChangeInvisibleDuration` 延长，并设置总处理上限。

## 8. Retry 不是限流工具

PushConsumer 普通消息通常按递增间隔重试；FIFO 重试间隔和阻塞语义不同。SimpleConsumer 的重试时机由 InvisibleDuration 控制。无论哪一种，都要先把失败分成：

| 类型 | 例子 | 处理 |
| --- | --- | --- |
| 瞬时依赖 | 数据库短暂切换 | 有界退避重试 |
| 永久数据错误 | Schema 不兼容、字段非法 | 快速进隔离/DLQ |
| 权限/配置 | 凭据过期、Topic 错误 | 告警并修复，不高频重试 |
| 程序 Bug | NullPointer、版本回归 | 熔断发布并回滚 |
| 下游容量不足 | 连接池满、限流 | 主动降速，保留在主队列 |

官方明确不建议用“返回消费失败”做流控。大量消息进入重试链路会增加额外存储与调度，并掩盖真正 lag。

## 9. DLQ 必须有业务所有者

超过最大重试次数后消息进入与 Consumer Group 相关的死信队列。DLQ 处理闭环：

1. 对新增速率和最老年龄告警；
2. 保存 event_id、Key、Topic、Group、重试次数和最后异常；
3. 判断是单条毒消息还是系统性失败；
4. 修复代码/数据/依赖后在隔离环境验证；
5. 使用受控工具按小批量重放到原 Topic 或修复 Topic；
6. 观察幂等命中、业务结果和再次失败；
7. 留存审批、操作者、范围和对账结果。

直接把整个 DLQ 一次性重放，可能再次压垮刚恢复的下游。

## 10. 积压能否追平的计算

```text
net_drain_rate = stable_consume_rate - current_produce_rate
catch_up_time  = backlog_messages / net_drain_rate
```

只有 `net_drain_rate > 0` 才能追平。还要按 Queue 计算：一个热点 Queue 不能用其他空闲 Queue 的平均余量替代。

例如积压 360 万条，生产保持 2 万条/秒，稳定消费 3 万条/秒，理想追平至少需：

```text
3,600,000 / (30,000 - 20,000) = 360 秒
```

实际还要加入重试、下游 P99、Rebalance 和热 Queue，容量计划应留明显余量。

## 11. 积压 Runbook

1. 确认告警真实：总 lag、最老年龄、受影响 Topic/Group；
2. 比较生产率与成功消费率，判断是在增长还是追平；
3. 下钻每个 Queue，识别倾斜与无 owner Queue；
4. 查看 Consumer 在线、Rebalance、本地缓存、线程池、GC；
5. 检查业务 handler P99、数据库/API 限流与连接池；
6. 检查 retry/DLQ 是否激增并分类异常；
7. 只有下游与 Queue 有余量时才扩 Consumer；
8. 必要时限流 Producer、降级非关键事件；
9. 恢复后对账 event_id、业务状态、重复和缺口。

## 12. 最小实验

1. 同一 Group 启动 1、2、超过 Queue 数的 Consumer，记录分配；
2. 提交业务后故意不 ACK，验证幂等命中；
3. PushConsumer 返回失败，记录 WaitingRetry 间隔和最大次数；
4. SimpleConsumer 设置过短 InvisibleDuration，观察并发重投；
5. 暂停 Consumer 制造积压，测真实 `net_drain_rate`；
6. 制造永久坏消息进入 DLQ，完成小批重放与审计；
7. 滚动发布 Consumer，测 Rebalance 期间重复和停顿。

## 13. 验收题

- SimpleConsumer 与 PushConsumer 的控制权差异？
- 业务完成后 ACK 丢失会怎样？
- Consumer 实例为何不能无限提升并行？
- DLQ 重放需要哪些安全条件？
- InvisibleDuration 过短和过长分别有什么后果？
- 为什么不能通过返回失败给消费链路限速？
- Broker lag 下降是否证明业务处理已完成？
- 怎样计算积压理论追平时间？

## 14. 参考资料

- [Consumer 类型](https://rocketmq.apache.org/docs/featureBehavior/06consumertype/)
- [消费重试](https://rocketmq.apache.org/docs/featureBehavior/10consumerretrypolicy/)
- [Consumer 领域模型](https://rocketmq.apache.org/docs/domainModel/09consumer/)
