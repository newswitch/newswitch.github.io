---
title: "Redis、Kafka、RabbitMQ 隔离联调与故障恢复"
sidebar_label: "07. 缓存与消息隔离联调"
sidebar_position: 7
description: "使用独立 Compose 服务和完整客户端工程，验证 Redis 回源边界、Kafka 发布及重复消费、RabbitMQ Confirm 与 ACK，并建立失败恢复的观察方法。"
tags: [SpringBoot, Redis, Kafka, RabbitMQ, 集成测试]
---

# Redis、Kafka、RabbitMQ 隔离联调与故障恢复

“依赖加好了、应用启动了”只证明一部分装配条件成立。缓存是否真的命中，消息是否路由成功，重复事件是否真的抵达消费者，都要通过外部服务和最终业务状态验证。本实验将三种客户端放进同一学习工程，但不要求业务同时使用两种消息队列。

## 1. 启动范围和实验安全边界

工程为 [deepening-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/spring-boot/deepening-lab)，Compose 将 Redis、Kafka 和 RabbitMQ 的端口只映射到 127.0.0.1；账号与明文通信仅用于本机。使用 Docker Compose v2，先检查相关端口没有被其他实验占用。

```bash
cd examples/spring-boot/deepening-lab
docker compose --profile brokers config
docker compose --profile brokers up -d --wait redis kafka rabbit
mvn -B -ntp -pl delivery -Pbrokers verify
docker compose --profile brokers logs --tail=100 kafka rabbit
docker compose --profile brokers down
```

最后的 down 只针对此 Compose 项目；执行前确认当前路径和项目名 `boot-deepening-lab`，不要对已有生产项目执行。服务不绑定业务数据卷；停止后不保留消息，不能拿这种临时拓扑做持久化灾备验证。

版本固定为 Redis 8.2.1、Apache Kafka 4.1.0、RabbitMQ 4.2.0，供重复实验，不表示这些镜像已完成生产安全审查。Kafka 是单节点 KRaft、副本数 1；RabbitMQ 是单节点普通耐久队列，不能从成功确认推断多节点容灾。

## 2. 默认测试和外部联调不是同一件事

```bash
# 本地 H2 事务、租约、去重与缓存错误策略
mvn -B -ntp -pl delivery verify

# 额外运行 BrokersIT，服务缺失会失败，不会自动跳过
mvn -B -ntp -pl delivery -Pbrokers verify
```

默认 13 项测试覆盖确定性的本地行为；`-Pbrokers` 再运行 3 项外部服务集成测试。当前编写环境没有启动 Docker 引擎，因此外部这 3 项的执行结果需在启动上述服务后取得，不能把“源码编译成功”当成“Broker 已联通”。

Maven Profile 决定是否执行 `*IT`，Spring Profile `brokers` 决定是否创建实际 broker 适配器与 listener。BrokersIT 自己启用后者。名称相同不意味着 Maven 自动把所有 Profile 传给 Spring。

## 3. Redis 实验怎样证明不是假命中

TaskCache 使用 StringRedisTemplate、独立前缀和 30 秒 TTL：

```text
lab:task:v1:alpha:<实验ID>
```

真实测试产生随机 ID，第一次加载 one 并统计回源次数，第二次传入返回 two 的加载器。若仍返回 one 且加载次数为 1，说明确实命中；随后检查 TTL、删除键，再读到 two。finally 只清理本次生成的键，不使用 FLUSHALL 或宽泛前缀删除。

tenant 和 ID 进行字符约束，防止分隔符让键发生歧义。真正 JSON 对象还需要显式 schema、类型和兼容策略；这个实验使用简单字符串，不能证明任意 Java 对象跨版本序列化都安全。

### 3.1 Redis 不可用后不能无限回源

connect-timeout=500ms、命令 timeout=300ms 是等待边界，除此之外 TaskCache 还用 Semaphore 将本进程回源并发限制为 4。缓存读写失败可以降级，拿不到回源名额则快速拒绝，不建立无限等待队列。

默认测试使用受控客户端异常和闩锁，让 4 个回源保持进行中，断言第 5 个被拒绝。这证明应用策略，不证明跨实例有全局配额；十个副本仍可能同时出现 40 个回源。生产还需数据库总预算和入口限流。

### 3.2 命中、失效和一致性分开验证

实验没有靠缓存提供强一致更新。数据库提交后删除 Redis 仍可能遇到删除失败和旧读回填；可靠失效应有持久化重试意图、版本控制或符合业务的短暂陈旧策略。不能看到一次 evict 成功就宣称并发一致性已解决。

## 4. Kafka 的完整交付路径

```text
Outbox 中稳定 eventId
→ KafkaPublisher 等待 send Future
→ boot-lab-events：key=taskId
→ ListenerContainer poll
→ TaskEvent.parse
→ Inbox 本地事务提交
→ listener 返回
→ RECORD 模式推进消费进度
```

生产者使用 acks=all、enable.idempotence=true；客户端等待上限是 5 秒，并设置发送阻塞和交付超时。超过等待时结果可能未知，Outbox 保留同一事件供重试。生产者幂等不负责数据库去重。[Spring Kafka 接入](https://docs.spring.io/spring-boot/reference/messaging/kafka.html)

`BrokersIT.kafkaRelayAndDuplicateConsumer` 创建一次任务，经 Relay 发送，再主动发布相同事件。测试不仅检查结果表只有一条，还等待消费者重复计数确实上升，避免“第二条还没被消费，测试就结束”的假阳性。

单分区是为了减少实验变量，不是吞吐建议。需要同聚合顺序时，还要控制多 Relay 的发送次序；单有相同 key 不能修正进入 Kafka 之前已经倒序的事件。

### 4.1 Kafka 失败为什么有时挡住整个分区

同步监听函数未返回成功，容器不能按正常路径推进进度。实验配置 DefaultErrorHandler：普通失败做两次短退避重试，非法协议字段不重试，耗尽后写入 `.DLT`。DeadLetterPublishingRecoverer 要求发送结果成功，否则恢复动作本身失败，不能无声跳过。[容器错误处理](https://docs.spring.io/spring-kafka/reference/kafka/annotation-error-handling.html)

转死信表示该记录离开正常处理路径，不表示业务已完成；死信不可用仍会阻塞恢复。生产需考虑权限、可重放性和死信里可能包含的敏感正文。

## 5. RabbitMQ 的两种确认不能互换

RabbitPublisher 将 JSON 作为持久化消息发送到 `boot-lab` 交换器的 `created` 路由。它生成本次发布的 correlation ID，但消息自身 eventId 保持不变。

等待结果时同时核对：

- Confirm 为 ACK：Broker 接受本次发布。
- CorrelationData 中没有 Return：mandatory 消息没有因无法路由返回。

Confirm ACK 不等于消费者处理完成；无法路由也可能得到 Confirm ACK，因此两者不能二选一。[确认机制](https://www.rabbitmq.com/docs/confirms)

消费者使用 manual 模式，先完成 Inbox 事务，再 basicAck。发生解析或业务异常时 basicReject(requeue=false)，交由该队列的 DLX 路由到 `.dead`。这是实验选择的“停放后人工/离线恢复”策略，不是自动重试所有故障，更不适合原样用于需要严格顺序的业务。

普通队列的死信转发并不天然具备跨故障绝不丢失的保证。若业务需要更强交付保证，应结合 quorum queue、相应死信能力和确认配置重新设计，不能只看到了死信队列名称就下结论。

## 6. 分层执行故障实验

先让正常联调通过，再单独改变一个因素。下面命令仅作用于本文项目：

```bash
# 暂时停止其中一个依赖，其他服务保持
docker compose --profile brokers stop redis
# 恢复后观察客户端重连、超时和缓存回源
docker compose --profile brokers start redis
```

Broker 的 stop/start 在其他窗口运行对应发送/消费时才有观察价值；只在应用完全停止后重启 Broker，不能验证发送途中的不确定窗口。使用自定义实验类调用 Relay.once，检查 Outbox sent、retry_at、attempts 和 Inbox，而不是只看日志有没有异常。

| 故障 | 应看到的证据 | 不应做的推断 |
| --- | --- | --- |
| Redis 拒绝连接 | 有限超时、受控回源或拒绝 | “直接回源一定安全” |
| Kafka 发送结果未知 | Outbox 保留并可重发 | “超时说明肯定没写入” |
| Rabbit 无匹配绑定 | Return 被发布端识别 | “Confirm ACK 已说明进队列” |
| 消费提交后再次交付 | duplicates 增长、业务结果仍 1 条 | “不再投递才叫可靠” |
| 永久错误 | DLT/DLQ 可查、正常进度按策略推进 | “lag=0 就全部成功” |

H2 默认在进程结束后丢失。若要实验进程重启恢复，可对本项目的全新测试目录使用 `jdbc:h2:file:./target/restart-demo;DB_CLOSE_ON_EXIT=FALSE`，保持同一库文件并依次启动，不让两个独立嵌入式进程争用它；真正多实例应换为独立数据库。

## 7. 重放和清理

先保存失败事件 ID、类型、失败阶段和脱敏诊断信息，再修复代码/依赖；选择小批重放，保留原 eventId，观察成功、重复、积压和失败。不要因为想“再试一次”就删除全体 Inbox 或重置所有消费组。

Kafka 重放要精确到测试 topic/消费组/partition；Rabbit 重投要保留正文协议和 eventId，并用 Confirm 检查重新发布。演练重放时不要把管理命令照搬到共享集群。

## 8. 练习与答案

### 8.1 外部联调测试为什么要等待重复计数

结果唯一可能只是第二条尚未处理。等待重复实际进入 Inbox，才能同时证明重复交付发生了且没有重复业务结果。

### 8.2 任务同时发送到 Kafka 和 RabbitMQ 能提高可靠性吗

不自动提高。两条链路会带来重复、副作用协调和两套恢复机制。本工程提供两种适配器作对照，实际业务应按需求选择，不能默认双写就是备份。

### 8.3 停止 Redis 后应用返回 503，是不是降级失败

不一定。若回源已经达到预算，快速拒绝是在保护数据库。应结合成功吞吐、错误比例和恢复时间判断，不把“不报错”作为唯一目标。

## 9. 关联与参考

- [Redis 缓存一致性](./01-Redis序列化缓存策略与一致性.md)
- [Outbox Relay 与去重](../03-data/08-OutboxRelay领取重发与消费者去重实战.md)
- [Redis 客户端支持](https://docs.spring.io/spring-data/redis/reference/redis.html)
