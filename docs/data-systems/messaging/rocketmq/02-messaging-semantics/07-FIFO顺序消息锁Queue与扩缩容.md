---
title: "FIFO 顺序消息、锁、Queue 与扩缩容"
sidebar_label: "07. FIFO 顺序消息、锁、Queue 与扩缩容"
sidebar_position: 7
description: "理解 RocketMQ 局部顺序、sharding key、Queue 锁、失败阻塞和扩缩容。"
tags: [RocketMQ, FIFO, Ordered Message]
---

# FIFO 顺序消息、锁、Queue 与扩缩容

FIFO 消息保证的是一个 MessageGroup 内的生产、存储与投递顺序，不是整个 Topic 的全局时间顺序。顺序越强，可并行度和故障绕行能力越低，必须先确定业务真正需要的顺序范围。

## 1. 三段顺序缺一不可

```text
生产顺序：同一 MessageGroup 的消息按业务先后串行发送
    ↓
存储顺序：Broker 按收到顺序写入对应有序队列
    ↓
投递顺序：前一条未完成时，后一条不越过它完成
```

如果订单服务在两个线程中先后生成 v2、v1，RocketMQ 无法推断真正业务顺序；它只能保留到达顺序。因此消息应携带业务版本或状态转换前置条件。

## 2. MessageGroup 才是 5.x 顺序键

```text
order_id=O1001
→ MessageGroup=O1001
→ stable ordered storage/delivery path

order_id=O1002
→ another MessageGroup
→ can be processed concurrently
```

细粒度 Group 让不同订单并行；把所有消息都使用 `global` Group 会退化为单串行通道。Group 数量不是越多越好，热点账户或大客户仍可能形成单 Group 长尾。

经典 4.x Remoting SDK 常通过 selector/sharding key 把同一业务键路由到同一 MessageQueue，并对 Queue 做有序消费；5.x FIFO 文档更强调 MessageGroup。迁移时应验证实际 SDK 和服务端，不要只替换类名。

## 3. FIFO Topic 与 Consumer Group

5.x 中先创建 FIFO 类型 Topic，并使 Consumer Group 使用有序投递：

```bash
sh bin/mqadmin updateTopic \
  -n nameserver-1:9876 \
  -c prod-cluster \
  -t order-fifo \
  -a +message.type=FIFO

sh bin/mqadmin updateSubGroup \
  -n nameserver-1:9876 \
  -c prod-cluster \
  -g prod.order.state-machine \
  -o true
```

参数以目标版本 `mqadmin help` 为准。Normal Topic 不能假定自动获得 FIFO 语义；同一 Topic 也不应混发 Normal、Delay、Transaction 消息。

## 4. Producer 端如何破坏顺序

即使 MessageGroup 正确，以下情况仍会倒序：

- 同一业务键由多个线程/实例并发发送；
- v1 第一次超时，v2 成功后 v1 才重试；
- 数据库事件产生顺序与事务提交顺序不同；
- Outbox relay 并发扫描同一 aggregate；
- Queue 数或 selector 变化导致相同 key 路由变化；
- 上游把重放事件与实时事件直接混在一起。

建议采用 Aggregate Version：

```text
event: { order_id: O1001, version: 7, type: PAID }
consumer state: current_version = 6

accept only when incoming_version = current_version + 1
duplicate when incoming_version <= current_version
gap when incoming_version > current_version + 1
```

这样能识别重复、倒序和缺口，但 gap 需要查询权威状态或补拉事件，不能无限等待。

## 5. Broker 与 Consumer 怎样保持投递顺序

FIFO 消息在同一 MessageGroup/有序队列中串行投递。经典实现可能体现为客户端对 MessageQueue 的锁和串行 ConsumeRequest；5.x Push/Simple Consumer 将有序行为与服务端 Group 元数据、消息状态机结合。

关键不是记住类名，而是验证：

1. 同一 Group 同一时刻是否只有一个有效处理者；
2. 前一消息未 ACK/成功时，后一条是否可见；
3. owner 失联后多久能转移；
4. 转移过程中是否可能重复；
5. 失败消息如何阻塞后续消息。

## 6. Head-of-Line Blocking

FIFO 的代价是队头阻塞：

```text
v7 poison message fails
→ v8, v9, v10 in same MessageGroup wait
→ other MessageGroups may continue
```

处理原则：

- 业务 handler 必须有 Deadline；
- 瞬时错误有界重试，永久错误尽快告警和隔离；
- 不为“维持顺序”设置无限重试；
- 隔离/跳过前明确业务是否允许越过该状态；
- 修复后按业务版本恢复，而不是粗暴重放整个 Topic；
- 监控最老阻塞 Group，而不只看 Topic 平均 lag。

对于“v7 永远失败时 v8 能否继续”没有通用答案。若状态机要求严格连续，必须先修复或补偿 v7；若事件彼此独立，说明不该使用同一个 MessageGroup。

## 7. 吞吐由 Group 分布决定

FIFO Topic 即使有很多 Queue，若 90% 流量属于一个 MessageGroup，吞吐仍由单 Group 串行处理限制。容量压测必须重放真实 Key 分布：

```text
effective_parallelism
≈ min(active message groups, queue/consumer capacity, downstream capacity)
```

观测 Top-N Group 速率、单 Group 最老年龄、处理 P99 和失败次数。只看整体 QPS 会隐藏热 Group。

## 8. 扩 Consumer 的边界

增加 Consumer 只能让不同 Queue/Group 更并行，不能拆分一个必须串行的热 Group。实例数超过有效 Queue/分片时继续扩容没有收益，反而增加 Rebalance。

滚动发布时：

1. 停止拉取新消息；
2. 等待当前 Group handler 完成或超时；
3. 提交成功状态；
4. 释放 ownership；
5. 新实例接管并从已提交位置继续；
6. 通过 event version 吸收可能的重复。

## 9. 增加 Queue 的迁移风险

若经典 selector 使用：

```text
queue = hash(business_key) % queue_count
```

从 8 增加到 16 后，多数 key 的映射会变化。旧 Queue 中的 v7 尚未消费，新 Queue 的 v8 可能先到。可选迁移方式：

- 停新写并等待旧积压清空后切换；
- 为路由引入版本，旧 key 暂时保持旧映射；
- 使用一致性哈希降低迁移比例，但仍要处理变化；
- 由业务版本状态机拒绝倒序并补偿；
- 新建 Topic，双写/校验/灰度迁移。

不要在高峰期直接修改 Queue 数并宣称“只会提升并行度”。

## 10. 全局顺序是否值得

单 Queue + 单 MessageGroup 可以获得接近全局串行的效果，但会带来：

- 吞吐受单路径限制；
- 任一毒消息阻塞全部业务；
- Broker/Consumer 切换期间全局停顿；
- 无法通过普通水平扩展解决热点；
- 多 Producer 的真实产生顺序仍需上游协调。

多数订单、账户、设备业务只需要 aggregate 内顺序。若只需要“最终状态正确”，业务版本 + 幂等状态机通常比强制全局 FIFO 更稳健。

## 11. 顺序异常 Runbook

发现倒序时先保存同一 business key 的：event_id、version、born/store/deliver time、msgId、MessageGroup、Queue、Producer instance、retry 次数和 Consumer instance。

按顺序检查：

1. 上游事件产生和数据库提交是否已经倒序；
2. 多 Producer/线程是否并发发送同一 Group；
3. v1 是否超时重试到 v2 之后；
4. Topic 类型和 MessageGroup 是否正确；
5. Queue 数、路由或 selector 是否变化；
6. Consumer 是否按 FIFO 模式、是否发生 Rebalance；
7. 业务是否把处理完成时间误认为投递顺序；
8. 版本状态机是否正确拒绝旧版本。

## 12. 最小实验

1. 创建 FIFO Topic，使用 100 个 MessageGroup 各发送 100 个递增版本；
2. 多 Consumer 并发处理，证明 Group 内有序、Group 间并发；
3. 故意让某 Group 的第 10 条失败，观察队头阻塞范围；
4. 在一次发送超时后发送下一版本，验证业务版本保护；
5. 滚动 Consumer，记录重复、ownership 转移与顺序；
6. 经典 selector 环境中修改 Queue 数，观察哈希映射变化；
7. 对比单全局 Group 与多细粒度 Group 的吞吐和 P99。

## 13. 验收题

- FIFO 的顺序范围是什么？
- 为什么仍需业务版本号？
- 毒消息如何影响后续顺序消息？
- 增加 Queue 为什么可能改变同 key 路由？
- 生产顺序、存储顺序和投递顺序分别由谁保证？
- Consumer 扩容为什么不能解决单热 MessageGroup？
- 什么时候应使用单全局 Group，代价是什么？
- 4.x Queue selector 与 5.x MessageGroup 迁移要验证什么？

## 14. 参考资料

- [FIFO 消息](https://rocketmq.apache.org/docs/featureBehavior/03fifomessage/)
- [Topic 消息类型](https://rocketmq.apache.org/docs/domainModel/02topic/)
- [消费重试](https://rocketmq.apache.org/docs/featureBehavior/10consumerretrypolicy/)
