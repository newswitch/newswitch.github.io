---
title: "Producer 同步/异步、重试、批量与可靠发送"
sidebar_label: "05. Producer 同步/异步、重试、批量与可靠发送"
sidebar_position: 5
description: "理解发送模式、路由、超时不确定性、重试重复、批量和可靠 Outbox。"
tags: [RocketMQ, Producer, Retry, Batch]
---

# Producer 同步/异步、重试、批量与可靠发送

Producer 的职责不只是调用 `send()`。它需要把业务事件变成可重试的不可变消息，获得路由、选择 Queue、控制在途请求，并把“确定成功、确定失败、结果未知”交给业务可靠性机制处理。

## 1. 一次发送的完整路径

```text
业务事务产生事件
→ 构造 event_id / key / tag / schema_version / body
→ 序列化并检查大小
→ 从 NameServer 或 Proxy 获得/刷新路由
→ 选择 Topic 中的 MessageQueue
→ 建立连接并发送请求
→ Broker 校验、追加、刷盘、复制
→ 接收 SendReceipt 或异常
→ 记录结果并驱动补偿
```

这个路径中，客户端超时只是“不再等待”，并不会撤销 Broker 端已经执行的写入。

## 2. 先区分客户端世代

| 维度 | 经典 3.x/4.x Remoting SDK | 5.x gRPC SDK |
| --- | --- | --- |
| 接入 | 客户端查 NameServer 后直连 Broker | 通常连接 Proxy endpoint |
| Producer Group | 历史概念和部分事务用途 | 普通 Producer 匿名化，不再作为核心资源 |
| 发送接口 | sync / async / oneway 等 | 重点为 sync / async，具体以 SDK 为准 |
| 消息类型 | 较多行为由客户端配置 | Topic 元数据约束更明确 |
| 重试参数 | SDK 本地参数较多 | 由新版 SDK/服务端语义共同决定 |

不要把 4.x 资料中的参数直接复制给 5.x SDK。先固定 Broker、Proxy、SDK 和 Admin 工具版本，再阅读对应 Javadoc/源码。

## 3. 同步与异步不是可靠性等级

### 3.1 同步发送 {/* #同步发送 */}

调用线程等待 receipt 或异常，编程简单，适合需要立即决定后续流程的场景。其吞吐受单次往返与 Broker 确认时间影响，通常要用多个受控并发而不是无限增加线程。

### 3.2 异步发送 {/* #异步发送 */}

调用快速返回，完成结果通过 Future/callback 到达，可隐藏网络等待并提高吞吐。但应用必须：

- 限制最大 in-flight 数和总字节；
- 处理成功、异常和 callback 自身异常；
- 将稳定 `event_id` 带入 callback 上下文；
- 发布/停机时停止接收新事件并等待在途请求排空；
- 对最终失败进入持久补偿，而不是只写一行日志。

### 3.3 Oneway {/* #oneway */}

经典 SDK 的 oneway 不等待发送结果，适合允许丢失的遥测类信息，不适合作为订单、资金或任务状态的可靠通道。5.x 是否提供、如何命名，以目标 SDK 为准。

## 4. 发送结果的三态模型

业务代码不能只使用布尔值：

| 状态 | 例子 | 业务动作 |
| --- | --- | --- |
| 确定成功 | 收到满足策略的成功 receipt | 记录 msgId/queue，并等待消费闭环 |
| 确定失败 | 参数非法、无权限、Topic 类型错误 | 修复配置/数据，不盲目重试 |
| 结果未知 | 超时、响应丢失、连接在返回前中断 | 使用同一 event_id 重试，并容忍重复 |

典型未知窗口：

```text
Broker append/flush/replicate 已完成
→ 响应包在网络中丢失
→ Producer Deadline 到期
→ Producer 只能知道“没收到结果”
```

RocketMQ 的内置发送重试不会保证最终一定发送成功。重试耗尽后，调用方仍需持久化待补偿事件、告警或回滚业务动作。

## 5. Timeout、Retry 与 Deadline 要统一预算

假设单次 timeout 为 3 秒、最多重试 2 次，最坏时间不应简单理解为 3 秒。还包括路由刷新、退避、连接建立和本地排队。上层 HTTP Deadline 如果只有 2 秒，底层仍在重试就会产生“调用方已经放弃、消息后来成功”的幽灵结果。

设计规则：

```text
local queue wait
+ each attempt timeout
+ retry backoff
+ route refresh/connect
< caller deadline
```

并且：

- 只重试可能恢复的网络、节点或限流错误；
- 参数、权限、Topic 类型等确定错误立即失败；
- 使用指数退避、抖动和总重试预算；
- 限制同时重试数量，避免 Broker 故障演化为 Producer 风暴；
- 相同业务事件重试时保持 `event_id` 不变；
- 事务消息的透明重试边界与普通消息不同，网络超时场景不能照搬普通重试假设。

## 6. Queue 选择与故障规避

普通消息通常由 SDK 在可写 Queue 中负载均衡；某 Broker 失败后，重试可能选择其他 Queue/Broker。这里要警惕：

- 路由缓存包含已经下线的 Broker；
- 自定义 selector 只按 `queueId`，没有处理 Broker 分布；
- Key 哈希倾斜形成单热 Queue；
- 重试切换 Queue 后，消息顺序发生变化；
- Topic Queue 数变化后，取模结果改变。

FIFO 消息不要自己随意拼一个哈希 selector 代替目标 SDK 的 MessageGroup 语义。跨版本时要验证同一业务键实际落点。

## 7. 消息构造决定后续能否运维

推荐在发送前校验：

```text
event_id         全局稳定，重试不变
business_key     可检索的业务键
schema_version   消费者兼容判断
occurred_at      业务发生时间
trace_id         调用链关联
producer         来源应用/版本
body checksum    外置 payload 时防篡改
```

消息体应控制大小。超大对象会增加序列化、网络、CommitLog、复制、消费缓存和重试成本。大文件通常存入对象存储，消息只携带不可变 URI、版本、大小和校验和；还要处理对象先写后发消息的孤儿清理。

## 8. 批量发送怎样权衡吞吐与延迟

Batch 把多条消息共享一次协议和网络开销，但带来：

- 第一条消息等待凑批，增加延迟；
- 单批过大占用连接、堆外内存和 Broker 请求线程；
- 批次失败时结果与补偿粒度变粗；
- 同一批消息通常需满足 Topic 等兼容约束；
- 重试整个批次会产生更多重复。

使用字节和时间双阈值：

```text
flush when batch_bytes >= B
   or now - first_message_time >= T
```

压测应记录 batch size 分布、单消息等待时间、Broker P99、失败批次大小和重复率，而不只看最高 TPS。

## 9. 数据库与消息的双写问题

下面的代码存在崩溃窗口：

```text
commit order database
→ process crashes
→ RocketMQ send never happens
```

反过来先发消息再提交数据库，也可能让消费者看到不存在/未提交的订单。常见解法：

### 9.1 Transactional Outbox {/* #transactional-outbox */}

同一个数据库事务写业务表和 outbox；Relay/CDC 独立发送，成功后标记。优点是权威状态清楚、可查询重放；代价是维护 relay、清理和积压。

### 9.2 RocketMQ Transaction Message {/* #rocketmq-transaction-message */}

先发 Half Message，再执行本地事务并提交消息；Broker 不确定时回查业务库。适合能够稳定实现事务状态查询的应用。

两种方案都不能消除消费端重复，消费者仍需幂等。

## 10. Producer 侧观测

至少按 Topic、消息类型、结果码和应用版本观测：

- 业务事件产生速率、发送尝试与成功率；
- sync/async 端到端 P50/P95/P99；
- 本地等待队列长度、in-flight 数/字节；
- retry 次数、最终失败和结果未知数量；
- 路由刷新、连接错误和 Broker/Proxy 选择；
- batch 条数/字节分布；
- outbox 待发送数量、最老年龄和补偿失败。

不要把 `event_id`、msgId 或 order_id 作为 Prometheus label；它们应进入结构化日志/Trace。

## 11. 发送故障排查

| 现象 | 顺序 |
| --- | --- |
| `NO_TOPIC_ROUTE_INFO` | Topic 名/Namespace → NameServer → Broker 注册 → 客户端路由缓存 |
| 权限/类型错误 | ACL 身份 → Topic 权限 → `message.type` → SDK 版本 |
| 大量 timeout | 本地队列 → Proxy/Broker 请求队列 → CommitLog/flush → replica ACK |
| 少量重复 | 重试/响应丢失 → event_id → 消费幂等证据 |
| 异步停机丢消息 | shutdown 顺序 → in-flight drain → callback/补偿存储 |
| 429/530 限流 | 生产速率、积压、存储压力 → 退避与入口限流 |

## 12. 最小可靠性实验

1. 发送带连续 `event_id` 的 10 万条消息并保存 receipt；
2. 分别测试 sync、async 和不同 in-flight 上限；
3. 在隔离环境注入响应延迟/断连，观察结果未知与重复；
4. 让 callback 故意抛异常，验证补偿是否仍生效；
5. 发布/停止 Producer，证明所有已接收业务事件都有成功或补偿状态；
6. 制造 Broker 限流并确认客户端退避不会形成重试风暴；
7. 对账“业务产生事件数、唯一 event_id、Broker 消息数、消费唯一数”。

## 13. 验收题

- 超时为什么不能解释为未写入？
- 异步发送如何保证进程退出不丢 callback？
- 批量如何交换吞吐与延迟？
- Outbox 解决哪个双写窗口？
- 上层 Deadline 为什么必须覆盖全部 retry 预算？
- 5.x 普通 Producer 为什么不应继续依赖 Producer Group 设计？
- 哪些错误可重试，哪些应立即失败？
- SEND_OK 的持久性还要结合哪些 Broker 配置解释？

## 14. 参考资料

- [Producer 领域模型](https://rocketmq.apache.org/docs/domainModel/05producer/)
- [发送重试与限流](https://rocketmq.apache.org/docs/featureBehavior/05sendretrypolicy/)
- [基础最佳实践](https://rocketmq.apache.org/docs/bestPractice/01bestpractice/)
