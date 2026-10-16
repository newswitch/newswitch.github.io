---
title: "Topic、MessageQueue、Tag、Key、Group 与消息类型"
sidebar_label: "02. Topic、MessageQueue、Tag、Key、Group 与消息类型"
sidebar_position: 2
description: "掌握 RocketMQ 资源模型、路由、过滤和消息类型边界。"
tags: [RocketMQ, Topic, MessageQueue, Group]
---

# Topic、MessageQueue、Tag、Key、Group 与消息类型

学习 RocketMQ 最容易犯的错误，是把 Topic、Queue、Group 都理解成“队列”。它们分别回答三个不同问题：消息属于哪类业务、消息怎样分片存储、哪一类消费者拥有独立进度。

## 1. 先建立资源关系

```text
RocketMQ Cluster
├─ Topic: order-events
│  ├─ MessageQueue 0 → Broker A
│  ├─ MessageQueue 1 → Broker A
│  ├─ MessageQueue 2 → Broker B
│  └─ MessageQueue 3 → Broker B
├─ ConsumerGroup: inventory-service → 一套独立消费进度
└─ ConsumerGroup: notification-service → 另一套独立消费进度

Message
├─ body：不可变业务载荷
├─ topic：顶层业务容器
├─ tag / properties：过滤属性
├─ key：检索和业务关联键
└─ message type：Normal / FIFO / Delay / Transaction
```

同一 Consumer Group 中的多个实例共同分摊消息；不同 Group 各自获得一份逻辑订阅。消费进度不是 Topic 的全局属性，而是至少与 Group、Topic、Queue 共同相关。

## 2. Topic：业务与权限边界

Topic 是消息传输与存储的顶层逻辑容器，不是单个物理文件。设计 Topic 时同时考虑：

- 业务相关性：订单事件与日志采集通常不放在一起；
- 消息类型：5.x 的 Normal、FIFO、Delay、Transaction 应建立不同 Topic；
- 权限边界：ACL 通常按 Topic 和 Consumer Group 授权；
- 生命周期：保留期、吞吐和故障影响面是否一致；
- 迁移边界：一个超大 Topic 会让扩容、限流和故障隔离变粗。

RocketMQ 5.x 可以在 Topic 元数据中声明消息类型。创建 FIFO Topic 的典型形式如下，执行前先用目标版本的 `mqadmin updateTopic -h` 核对参数：

```bash
sh bin/mqadmin updateTopic \
  -n nameserver-1:9876 \
  -c prod-cluster \
  -t order-fifo \
  -a +message.type=FIFO

sh bin/mqadmin topicRoute \
  -n nameserver-1:9876 \
  -t order-fifo
```

不要依赖自动创建 Topic 作为生产流程。显式创建才能评审类型、Queue 数、权限、归属人和容量。

## 3. MessageQueue：存储、并行与顺序单元

Topic 由一个或多个 MessageQueue 组成。Queue 同时影响：

1. Producer 将消息写到哪个分片；
2. Broker 上逻辑 ConsumeQueue 的组织；
3. 同一 Group 能达到的有效消费并行度；
4. FIFO 消息的顺序范围；
5. 扩容和重平衡时的迁移粒度。

设某 Topic 有 8 个 Queue，同一 Group 有 12 个消费实例，则稳定状态下最多约 8 个实例能分到 Queue；多出的实例通常不会凭空增加吞吐。反过来，Queue 过多会增加路由、文件、调度和重平衡成本。

增加 Queue 只改变后续路由能力，不会重新散列已经写入的历史消息。FIFO 场景修改 Queue 数还可能让相同业务键的新旧消息位于不同 Queue，必须设计迁移窗口。

## 4. Message：不可变事件而不是远程方法参数

一个可运维的消息至少应包含：

| 字段 | 建议 | 原因 |
| --- | --- | --- |
| `event_id` | 全局稳定且重试不变 | 消费幂等与审计 |
| `business_key` | 订单号、任务号等 | 查询、分片和故障关联 |
| `event_type` | 明确业务动作 | 避免消费者猜测 body |
| `schema_version` | 可演进版本 | 支持兼容读与灰度 |
| `occurred_at` | 业务发生时间 | 区分产生、写入和消费时间 |
| `trace_id` | 贯穿调用链 | 端到端定位 |
| `body` | 小而自包含或不可变引用 | 控制消息大小和重放语义 |

Broker 5.x 中的消息是不可变的。若业务状态变化，应发布新事件，而不是设想修改旧消息。

## 5. Key、Tag 与 Properties 不可混用

### 5.1 Key {/* #key */}

Key 适合稳定业务 ID，主要用于查询、关联和排障。它不是数据库唯一索引：哈希索引可能碰撞，同一业务也可能有多条事件。真正的幂等应依赖业务库唯一约束或状态机。

### 5.2 Tag {/* #tag */}

Tag 是单消息的轻量分类属性，适合 `created`、`paid`、`cancelled` 这类低基数值。消费者可使用 Tag 表达式让 Broker 过滤。

### 5.3 自定义 Properties {/* #自定义-properties */}

SQL92 Filter 可以针对自定义属性进行条件过滤，但 Broker 需要计算表达式。属性不存在、类型比较异常或表达式结果不是布尔值时，消息可能被过滤掉。过滤表达式上线前要用真实脏数据验证。

不要把租户鉴权寄托在过滤表达式上；过滤决定“订阅什么”，ACL 才决定“允许访问什么”。

## 6. 四种消息类型及其边界

| 类型 | 解决的问题 | 不保证什么 |
| --- | --- | --- |
| Normal | 普通异步解耦 | 不保证业务只执行一次 |
| FIFO | 同一 MessageGroup 内有序 | 不保证 Topic 全局顺序 |
| Delay | 到指定时刻后才可消费 | 不保证硬实时准点执行 |
| Transaction | 本地事务与消息可见性的最终一致 | 不保证下游业务自动提交 |

从 5.x 开始应把消息类型当作 Topic 的强语义。旧 4.x 客户端、自动建 Topic 和升级保留配置可能影响验证行为，因此迁移时必须实际发送错误类型做负向测试，不能只看配置文件。

## 7. Consumer Group：一份业务消费语义

Group 不是简单的客户端名称，而是一组必须保持一致的消费行为：

- 订阅哪些 Topic；
- 使用什么过滤表达式；
- 并发还是 FIFO 投递；
- 重试次数和策略；
- 消费起点与进度；
- 谁负责幂等、DLQ 和重放。

同一 Group 中不同实例配置了不同订阅表达式，会产生难以预测的遗漏或抖动。配置中心应把订阅作为不可随实例漂移的发布物。

RocketMQ 5.x 的 Producer 是匿名实体，旧 3.x/4.x 文档中的 Producer Group 不应继续当作 5.x 资源规划核心。Consumer Group 仍然是重要的服务端元数据和消费进度边界。

## 8. 命名与资源治理

推荐名称体现环境、领域与用途，例如：

```text
Topic:          prod.order.order-events
ConsumerGroup:  prod.inventory.reserve-stock
Key:            order_id=202608180001
Tag:            paid
```

生产治理表至少记录 Owner、数据级别、消息类型、Schema、Queue 数、峰值 QPS、保留期、Producer、Consumer Group、ACL、SLO、重试/DLQ 策略和下线日期。

避免把大量临时业务直接创建成普通 Topic。RocketMQ 5.5 的 LiteTopic 是父 Lite Topic 下的轻量、带 TTL 的二级通道，适合会话/任务级大量动态通道；它不是普通 Topic 的无条件替代品，每个 LiteTopic 默认单 Queue，单通道吞吐和可观测能力有不同边界。

## 9. 从现象反推资源层

| 现象 | 优先检查 |
| --- | --- |
| 只有一个 Group 收不到 | Group 订阅、Filter、消费进度、ACL |
| 所有 Group 都收不到 | Producer、Topic 路由、Broker 写入 |
| 消费实例很多但吞吐不升 | Queue 数、热 Queue、下游瓶颈 |
| Key 查到多条 | 重试重复、Key 非唯一、索引碰撞 |
| FIFO 出现倒序 | MessageGroup、Producer 并发、Queue 变更、业务版本 |
| 新消息类型发送失败 | Topic 类型、服务端版本、SDK/Proxy 兼容 |

## 10. 最小实验

1. 创建 Normal 与 FIFO 两个 Topic，显式声明类型；
2. 向 Normal Topic 发送 100 条带连续 `event_id` 的消息；
3. 建立两个 Consumer Group，证明二者各获得完整消息；
4. 同一 Group 启动多实例，记录 Queue 分配；
5. 使用 Tag 和 SQL92 分别过滤，并插入缺失属性的消息；
6. 尝试向 Normal Topic 发送 FIFO 消息，验证目标版本的类型检查；
7. 增加 Queue 后观察新旧路由，不对历史消息作重新分片假设。

## 11. 验收题

- Topic 与 MessageQueue 的关系是什么？
- 两个 Consumer Group 会怎样消费同一消息？
- Key、Tag 和自定义属性分别用于什么？
- Queue 增加为何不自动改变旧消息顺序？
- 为什么 5.x 中不同消息类型应使用不同 Topic？
- Consumer Group 中哪些行为必须一致？
- LiteTopic 为什么适合海量临时通道，又为什么不适合高吞吐单通道？

## 12. 参考资料

- [RocketMQ 领域模型](https://rocketmq.apache.org/docs/domainModel/01main/)
- [Topic 与消息类型](https://rocketmq.apache.org/docs/domainModel/02topic/)
- [消息过滤](https://rocketmq.apache.org/docs/featureBehavior/07messagefilter/)
- [LiteTopic](https://rocketmq.apache.org/docs/domainModel/03litetopic/)
