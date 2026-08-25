---
title: "AMQP、Exchange、Queue、Binding 与 Virtual Host"
sidebar_label: "02. AMQP 与核心资源模型"
sidebar_position: 2
description: "深入解释 RabbitMQ 中 Connection、Channel、Virtual Host、Exchange、Binding、Queue 和消息属性如何共同决定路由与生命周期。"
tags: [RabbitMQ, AMQP, Exchange, Queue, Binding, Virtual Host]
---

# AMQP、Exchange、Queue、Binding 与 Virtual Host

RabbitMQ 的资源模型不是 `Producer → Queue` 两点连线。AMQP 0-9-1 将发布端和存储端通过 Exchange 与 Binding 解耦，使同一条消息可以按业务规则进入零个、一个或多个 Queue。

## 1. 完整资源关系

```text
RabbitMQ Cluster
└── Virtual Host /
    ├── Users and Permissions
    ├── Exchanges
    │   └── Bindings
    ├── Queues / Streams
    ├── Policies
    └── Connections
        └── Channels
```

Virtual Host 是逻辑隔离边界，不是虚拟机。不同 Virtual Host 中可以存在同名 Exchange 和 Queue，它们互相不可见。

## 2. Connection 与 Channel

### 2.1 Connection

Connection 是客户端与 RabbitMQ 节点之间的 TCP/TLS 连接，负责：

- 身份认证；
- Virtual Host 选择；
- 心跳和故障检测；
- 承载一个或多个 Channel；
- 网络流控和连接生命周期。

大量短连接会增加 TLS、认证、文件描述符和 Erlang 进程开销。客户端通常使用长连接。

### 2.2 Channel

Channel 是 Connection 内的轻量逻辑会话。声明资源、发布、消费、Confirm 和事务都在 Channel 上进行。

```text
1 TCP Connection
├── Channel 1：Publisher A
├── Channel 2：Publisher B
└── Channel 3：Consumer
```

Channel 错误可能只关闭该 Channel，而不是整个 Connection。例如声明一个已存在 Queue 时使用了不兼容参数，Broker 会关闭 Channel 并返回协议错误。

客户端不应无限创建 Channel，也不应在不支持线程安全的情况下跨线程共享一个 Channel。

## 3. Virtual Host 的隔离边界

每个 Virtual Host 有独立的：

- Exchange、Queue、Binding；
- Policy 和 Runtime Parameter；
- 用户 configure/write/read 权限；
- 消息和队列统计；
- 部分资源限制。

适合按环境、租户或业务域隔离，但它仍共享同一 RabbitMQ 节点的 CPU、内存、磁盘、网络和 Erlang VM。Virtual Host 不是性能上的硬隔离。

权限通常分为：

```text
configure：声明/删除Exchange、Queue、Binding
write：向Exchange发布
read：从Queue消费
```

## 4. Exchange 的职责

Exchange 接收 Publisher 消息，根据类型、Routing Key、Headers 和 Binding 选择目标。Exchange 通常不保存消息。

### 4.1 Direct Exchange

Routing Key 与 Binding Key 精确匹配：

```text
routing_key=order.created
→ binding_key=order.created
→ order-created.queue
```

适合明确业务类别和工作路由。

### 4.2 Fanout Exchange

忽略 Routing Key，将消息路由到所有绑定目标：

```text
order.event
├→ sms.queue
├→ search.queue
└→ audit.queue
```

适合广播。

### 4.3 Topic Exchange

使用点分词和通配符：

```text
*  匹配一个单词
#  匹配零个或多个单词
```

示例：

```text
order.*        → order.created、order.cancelled
order.#        → order.created、order.pay.success
*.error        → payment.error、inventory.error
```

通配符过宽会让消息进入非预期 Queue，应把 Routing Key Schema 作为接口管理。

### 4.4 Headers Exchange

根据消息 Headers 匹配，适合无法用一个 Routing Key 表达的属性组合。它会增加配置和理解成本，优先确认 Topic 是否已经足够。

### 4.5 Default Exchange

名称为空字符串的特殊 Direct Exchange。每个 Queue 会自动以自己的名称作为 Binding Key 绑定到 Default Exchange：

```text
exchange=""
routing_key="task.queue"
→ task.queue
```

这让发布看起来像直接写 Queue，但协议路径仍经过 Exchange。

## 5. Binding 是路由表项

Binding 连接：

- Exchange → Queue；
- Exchange → Exchange。

它包含 source、destination、binding key 和可选参数。同一个 Queue 可以绑定多个 Exchange，一个 Exchange 也可以路由到多个 Queue。

资源声明顺序通常是：

```text
declare exchange
→ declare queue
→ bind queue to exchange
→ publish/consume
```

生产系统可以由应用声明拓扑，也可以由平台预创建。关键是声明必须幂等，并保证参数一致。

## 6. Queue 的关键属性

### 6.1 Durable

Broker 重启后 Queue 定义是否恢复。Durable Queue 不等于其中所有消息都持久。

### 6.2 Exclusive

通常只允许声明它的 Connection 使用，并在 Connection 关闭时删除。适合临时回调队列，不适合固定业务 Queue。

### 6.3 Auto-delete

满足队列曾有消费者、最后一个消费者消失等条件后自动删除。它和 Exclusive、客户端重连之间可能产生声明/删除竞态。

### 6.4 Queue Type

| 类型 | 主要特点 |
| --- | --- |
| Classic Queue | 传统通用 Queue，适合不需要复制或特定兼容场景 |
| Quorum Queue | 基于 Raft 的复制队列，面向数据安全和高可用工作队列 |
| Stream | 追加式、保留型数据结构，支持按 Offset 重读和较大吞吐 |

队列类型不能只按吞吐选择，还要考虑消息大小、保留、重复读取、节点故障和功能支持。

## 7. Queue 声明为什么会失败

同名 Queue 已存在时，再声明必须使用兼容属性。例如 durable、exclusive、auto-delete、arguments 或 queue type 不一致，Channel 会收到 `PRECONDITION_FAILED`。

这类问题常发生在：

- 新旧应用版本声明参数不同；
- 手工创建与代码声明不一致；
- Policy 修改了有效参数；
- Queue 从 Classic 迁移到 Quorum 时直接复用名称。

发布前应在变更流程中验证拓扑，而不是让第一批生产请求触发声明冲突。

## 8. 消息属性与 Queue 属性不是一回事

消息可包含：

- delivery mode；
- content type/encoding；
- message ID、correlation ID；
- timestamp、expiration；
- type、app ID；
- headers；
- reply-to。

Queue 属性控制容器生命周期和行为，消息属性控制单条消息。消息 ID 可以帮助幂等，但 RabbitMQ 不会自动用它去重。

## 9. Unroutable 消息

没有 Binding 匹配时，必须明确策略：

```text
mandatory=true
→ Publisher处理basic.return

Alternate Exchange
→ 路由到unrouted.queue

两者都没有
→ 消息可能被丢弃
```

生产告警应监控 returned/unroutable，而不是等业务发现数据缺失。

## 10. 路由设计示例

订单事件：

```text
Exchange: business.events (topic)

Routing Keys:
order.created
order.paid
order.cancelled

Bindings:
inventory.queue  ← order.created
shipping.queue   ← order.paid
audit.queue      ← order.#
```

每个下游拥有独立 Queue 和消费进度。不要让库存、物流和审计三个 Consumer 竞争同一个 Queue，否则每条消息只会由其中一个业务处理。

## 11. 命名与治理

推荐命名表达业务和环境，避免把物理节点写进名称：

```text
Exchange: domain.events
Queue:    consumer-purpose.queue
Routing:  entity.event[.version]
```

同时治理：

- 谁拥有 Exchange/Queue；
- Routing Key Schema；
- 消息格式和版本；
- 最大消息大小；
- TTL、DLX 和重试策略；
- Queue Type 和副本；
- 生产者/消费者权限；
- 删除和迁移流程。

## 12. 最小实验

1. 声明 direct、fanout 和 topic Exchange；
2. 为两个 Queue 配置不同 Binding；
3. 发布可路由和不可路由消息；
4. 使用 `mandatory=true` 接收 return；
5. 故意用不同 durable 参数重新声明同名 Queue，观察 Channel 关闭；
6. 在两个 Virtual Host 中创建同名 Queue，验证隔离；
7. 比较一个 Queue 多 Consumer 与多个 Queue 各自 Consumer 的结果。

## 13. 参考资料

- [RabbitMQ Exchanges](https://www.rabbitmq.com/docs/exchanges)
- [RabbitMQ Queues](https://www.rabbitmq.com/docs/queues)
- [RabbitMQ Virtual Hosts](https://www.rabbitmq.com/docs/vhosts)
- [RabbitMQ Channels](https://www.rabbitmq.com/docs/channels)
