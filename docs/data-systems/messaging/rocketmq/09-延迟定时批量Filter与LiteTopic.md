---
title: "延迟/定时消息、批量、Filter 与 LiteTopic"
sidebar_label: "09. 延迟/定时消息、批量、Filter 与 LiteTopic"
sidebar_position: 9
description: "理解 RocketMQ 特殊消息能力、时间精度、过滤、批量与版本边界。"
tags: [RocketMQ, Delay Message, Timer, Filter, LiteTopic]
---

# 延迟/定时消息、批量、Filter 与 LiteTopic

这四类能力解决的问题完全不同：Delay/Timer 控制消息何时可见，Batch 摊薄传输成本，Filter 控制订阅集合，LiteTopic 解决海量动态细粒度通道。生产设计时必须分别验证语义和容量，不能把“5.5 新特性”当作默认成熟配置。

## 1. 延迟消息到底延迟哪一步

延迟/定时消息是在目标时间之前不进入普通可消费状态。它控制的是“可投递时间”，不是业务完成时间：

```text
business creates message at T0
→ Broker stores scheduled message
→ target delivery time T1
→ message becomes Ready around T1
→ consumer fetch/local queue at T2
→ business completes at T3
```

真正要观测三种偏差：

```text
schedule_lag = T2 - T1
process_time = T3 - T2
end_to_end   = T3 - T0
```

Broker 时钟、定时存储/扫描、Broker 压力、Consumer lag 和下游耗时都会让 T3 晚于 T1。因此它适合订单超时检查、延后通知、重试调度等软实时场景，不适合要求毫秒级硬实时触发的控制系统。

## 2. 延迟任务必须二次判断业务状态

“30 分钟后关单”不能直接执行关闭：

```text
receive timeout-check(order_id, expected_version)
→ read authoritative order state
→ if still UNPAID and version matches: close idempotently
→ if already PAID/CANCELLED: no-op and ACK
```

因为消息被创建后，订单可能已经支付；消息也可能重复。必须保存 event_id、目标执行时间、业务键和期望版本。

同时确认：目标版本允许的最大延迟范围、时间精度、保留策略、时钟同步和故障恢复语义。超过支持范围的多年定时任务，通常更适合业务调度数据库/工作流系统。

## 3. 延迟堆积的容量与故障边界

未来待触发消息也占用存储。估算至少包含：

```text
scheduled_storage
≈ scheduled_rate × average_wait_time × encoded_bytes
```

还要考虑峰值同时到期造成的“定时洪峰”。例如每天 00:00 同时触发千万任务，会把存储调度问题变成瞬时 Producer/Consumer/下游容量问题。应分散到期时间、限流消费并设计业务优先级。

故障恢复时要验证：

- Broker 重启后未到期消息仍存在；
- 已到期但未投递的消息怎样补发；
- 主从切换后定时状态是否一致；
- 时钟跳变/NTP 校时是否造成提前或延后；
- 到期峰值是否压垮 Consumer。

## 4. Batch 发送不是“大包越大越好”

批量的目标是摊薄协议、系统调用和网络往返：

```text
small messages
→ batch by max_bytes or max_wait
→ one request
→ Broker validates and stores
```

权衡：

| 批量增大 | 收益 | 代价 |
| --- | --- | --- |
| 条数/字节更多 | QPS/协议开销下降 | 第一条等待更久 |
| 单请求更大 | 网络效率更好 | 内存峰值与 P99 增大 |
| 失败粒度更粗 | 调用次数减少 | 重试重复范围扩大 |

按真实消息大小分布设 `max_bytes + max_wait + max_count`，并对超限单条消息快速失败。不要只按条数，因为同样 100 条可能相差几个数量级的字节。

## 5. Tag Filter 的适用范围

Tag 适合低基数、稳定的业务分类：

```text
Topic: order-events
Tag: CREATED / PAID / CANCELLED
```

Consumer 订阅 Tag 表达式，Broker 在投递前过滤。优点是简单、成本低；缺点是表达能力有限。Tag 不是业务 Key，也不应包含用户 ID 这类高基数动态值。

## 6. SQL92 属性过滤

Producer 为消息添加自定义属性，Consumer 提交 SQL92 表达式：

```text
Region IS NOT NULL AND Region = 'east' AND price > 100
```

Broker 对候选消息计算表达式。要注意：

- 属性都是消息契约的一部分，需要 Schema 和类型约束；
- 缺失属性、NULL、字符串与数字误比较可能让结果不是 true；
- 表达式计算消耗 Broker CPU；
- 同一普通 Consumer Group 的订阅应保持一致；
- Filter 不是安全边界，没有权限的消息不应只靠表达式隐藏。

上线前准备包含缺失、空值、非法类型和老 Schema 的数据集做负向测试。

## 7. Broker Filter 与业务规则的边界

过滤条件应稳定且用于“哪个服务需要哪类事件”。频繁变化、需要外部状态或非常复杂的业务规则，不适合放进 Broker SQL。更稳妥的方式是建立清晰 Topic/Tag，Consumer 收到后依据自己的权威状态决策。

如果 Filter 变更可能让历史消息从“不匹配”变为“匹配”，要明确是否需要 offset 回退和重放，不能假设 Broker 会主动补发过去被过滤的消息。

## 8. RocketMQ 5.5 LiteTopic 是什么

LiteTopic 是 Lite 类型父 Topic 内的轻量二级通道，用于会话、任务、用户等海量动态隔离：

```text
Parent Lite Topic: agent-sessions
├─ LiteTopic: session-001 → one ordered queue + TTL
├─ LiteTopic: session-002 → one ordered queue + TTL
└─ ... millions of lightweight channels
```

RocketMQ 5.5.0 Server 开始支持 LiteTopic；官方兼容表要求相应 gRPC SDK 版本。采用前以实际下载页和 SDK release 核对，不要仅依据服务端版本。

核心语义：

- LiteTopic 在父 Topic 内唯一；
- 首次发送/订阅可以自动创建；
- 长时间无消息后按 TTL 自动删除并释放配额；
- 每个 LiteTopic 默认一个 Queue，天然有序但单通道 TPS 有限；
- 同一 Group 的不同 Consumer 可动态订阅不同 LiteTopic 集合；
- 总吞吐通过大量 LiteTopic 分散，而不是让单 LiteTopic 无限扩展。

## 9. LiteTopic 与普通 Topic 的选择

| 维度 | LiteTopic | 普通 Topic |
| --- | --- | --- |
| 数量 | 面向海量动态二级通道 | 面向稳定业务资源 |
| 生命周期 | 首次使用创建、TTL 回收 | 管理员显式创建/删除 |
| 单通道 Queue | 默认 1，强调有序 | 可配置多个 Queue |
| 订阅 | 可动态按 LiteTopic 调整 | 同 Group 通常要求一致 |
| 权限/隔离 | 细粒度通道 | Topic 级为主 |
| 可观测 | 能力与普通 Topic 不完全相同 | 指标和工具更成熟 |

若业务只有几十个稳定事件类型，普通 Topic + Tag 更简单。LiteTopic 的价值来自“海量、动态、短生命周期、细粒度独占消费”，不是因为它更新。

## 10. LiteTopic 上线清单

1. 固定 Broker 5.5.0、Proxy、gRPC SDK、Dashboard 和 mqadmin 版本；
2. 创建 Lite 类型父 Topic，明确 TTL 与配额；
3. 压测父 Topic 总量、单 LiteTopic TPS 和并发订阅数；
4. 验证自动创建、过期删除、名称复用和权限；
5. 验证 Broker/Proxy 滚动升级与主从切换；
6. 观测 LiteTopic 数量、创建/删除速率、积压和长轮询资源；
7. 验证客户端断线重连后的动态订阅恢复；
8. 准备降级到普通 Topic/外部会话路由的方案。

## 11. 常见故障

| 现象 | 检查 |
| --- | --- |
| 定时消息晚很多 | Broker 时钟/定时调度 → 到期洪峰 → Consumer lag → 下游 |
| 过滤后全无消息 | 订阅表达式 → 属性存在/类型 → Broker SQL 支持 → Group 一致性 |
| 批量 P99 上升 | 凑批等待 → batch bytes → Broker request/内存 → retry |
| LiteTopic 自动消失 | TTL、最后消息时间、父 Topic 配置 |
| 单 LiteTopic 吞吐低 | 默认单 Queue/有序限制、单 Consumer handler |
| 大量 LiteTopic 建立失败 | 版本矩阵、父 Topic 类型、配额、Proxy/SDK |

## 12. 最小实验

1. 创建 Delay Topic，发送不同目标时间的消息，记录 T0/T1/T2/T3；
2. 修改业务状态后再消费超时消息，证明二次判断与幂等；
3. 制造同一时刻到期洪峰，观察 schedule lag 与 Consumer lag；
4. 对比单条与不同 batch bytes/max_wait 的吞吐和 P99；
5. 对 Tag、SQL92、缺失属性和类型错误做过滤矩阵；
6. 在 5.5.0 隔离集群创建 Lite 父 Topic和多个 LiteTopic；
7. 验证 TTL 回收、动态订阅、单通道顺序和客户端重连。

## 13. 验收题

- 定时消息为何不能保证毫秒硬实时？
- 消费时为何还需检查业务状态？
- SQL Filter 的成本在哪里？
- 新 Topic 能力上线为何需全链路版本矩阵？
- Filter 变更后为什么不会自动补发过去不匹配的历史消息？
- LiteTopic 为什么能支持海量通道但单通道吞吐有限？
- `schedule_lag` 与业务处理时间怎样分开？
- 批量的字节阈值和等待阈值分别控制什么？

## 14. 参考资料

- [延迟消息](https://rocketmq.apache.org/docs/featureBehavior/02delaymessage/)
- [消息过滤](https://rocketmq.apache.org/docs/featureBehavior/07messagefilter/)
- [LiteTopic](https://rocketmq.apache.org/docs/domainModel/03litetopic/)
- [RocketMQ 5.5.0 Release Notes](https://rocketmq.apache.org/release-notes/)
