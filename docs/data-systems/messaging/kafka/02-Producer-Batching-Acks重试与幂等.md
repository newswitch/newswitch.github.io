---
title: "Kafka Producer：Batching、Acks、重试与幂等生产"
sidebar_label: "02. Kafka Producer：Batching、Acks、重试与幂等生产"
sidebar_position: 2
description: "沿发送路径解释批处理、acks 与 min ISR、幂等约束、超时和业务重复，结合 Kafka 4.1 参数与诊断证据建立可靠发送边界。"
tags: [Kafka Producer, Acks, Batching, 幂等]
---

# Kafka Producer：Batching、Acks、重试与幂等生产

Producer 的目标是在吞吐、延迟、可靠性和内存之间平衡。业务线程调用 `send` 成功返回 future，不代表 broker 已持久确认；异步错误必须被回调、指标或 future 捕获。

本文以 Apache Kafka 4.1 Java Producer 为主线，参数与实现核对 4.1 文档及 `4.1.0` 源码，不把它称为所有发行版的最新行为。非 Java 客户端的默认值、队列和超时接口可能不同。配置、输出与数值均为隔离实验的教学示例。

## 1. 发送路径

```mermaid
flowchart LR
  A["业务记录"] --> B["Serializer"] --> C["Partitioner"]
  C --> D["Record Accumulator"] --> E["Sender Batch"]
  E --> F["Leader Broker"] --> G["Replica ACK"]
```

Serializer 决定字节和 schema；Partitioner 根据显式 partition、key 或策略选择分区；Accumulator 按 partition 聚合 batch；I/O 线程发送并处理 ACK/重试。

图中的副本确认按 ACK 与 ISR 条件参与完成判定，不表示 acks=0/1 也等待所有副本确认。

业务线程先完成序列化、元数据和分区选择，再把记录放入本地缓冲；Sender 才负责组装请求与网络交互。即使 API 是异步的，`send()` 也可能等待元数据或可用缓冲，不是保证立即返回且永不阻塞。

一条记录至少有三个不同状态：调用已返回、broker 已按 ACK 条件接受、下游业务已处理。Producer 的成功回调只到第二层，不承诺第三层。

## 2. Key 与分区

相同业务 key 通常映射到同 partition，从而获得该 key 的日志顺序。Key 改变、partition 数增加、partitioner 版本变化都可能改变映射。无 key 的粘性批策略可提高 batching，但不能提供业务 key 顺序。

这里“相同”首先是相同序列化字节。字符串 `"42"`、整数编码的 42、前面补零的 `"042"`，不一定有相同路由。显式指定 partition 或自定义策略时，也不能再用默认 key 哈希规则解释结果。

增加分区后，同一个订单的新记录可能去新分区，旧记录仍在旧分区；Kafka 不会把这两段历史自动合成业务总顺序。多个 Producer 同时发送同 key，也只形成 broker 实际追加的顺序，不等于应用创建事件的墙钟顺序。

## 3. Batching 与压缩

更大 batch 和适度等待能提高压缩比、减少请求与系统调用，但增加排队延迟和 Producer 内存。判断参数不能只看 batch 上限，要看实际 batch-size 分布、records/request、compression ratio 和 buffer pool wait。

压缩由 Producer 对 batch 执行，broker 通常存储压缩 batch。选择 codec 应比较 CPU、网络、磁盘和端到端延迟。

| 参数 | Kafka 4.1 Java 默认值 | 负责什么 |
| --- | --- | --- |
| `batch.size` | 16384 字节 | 单个分区批次的常规容量目标，不是全 Producer 总内存或最大记录条数 |
| `linger.ms` | 5 毫秒 | 未满批次主动等待更多记录的时间，满批可提前发出 |
| `buffer.memory` | 33554432 字节，32 MiB | 缓冲待发送记录的内存预算，不是整个 JVM 内存上限 |
| `compression.type` | `none` | 可选 gzip/snappy/lz4/zstd 等；CPU 与带宽成本需一起测 |
| `max.request.size` | 1048576 字节，1 MiB | 限制请求与未压缩批次规模，还要配合 broker/topic 限制 |

Kafka 4.0 起 linger 默认从 0 改为 5 毫秒，不能照抄旧文章。实际等待还受背压、连接、元数据等影响，因此 `linger.ms=5` 不是“每条消息额外固定 5 毫秒”，也不是端到端延迟上限。[Producer 配置](https://kafka.apache.org/41/configuration/producer-configs/)给出了默认值与约束。

例如 100 个活跃分区、每个先分配一个 64 KiB 的批次缓冲，仅这些缓冲就约 6.25 MiB；存在多个在途批次和其他开销时还会增加。按“单批平均 1 KiB 记录”粗算 64 条也只是忽略协议与头部的估计，不能把 batch.size 当成精确条数控制。

单条大记录不会因为把 batch.size 设小就被自动切成多条业务消息。排查超大消息应同时检查序列化后大小、请求/批次限制、topic/broker 限制和 consumer 的接收行为。

## 4. Acks 与副本

### 4.1 三种 ACK 条件

| `acks` | 何时认为请求完成 | 故障窗口 |
| --- | --- | --- |
| `0` | 不等 broker 的写入响应 | 不能获知多数 broker 写入错误，没有可靠的 broker 确认结果 |
| `1` | Leader 本地追加后响应，不等所有同步副本追上 | Leader 在副本复制前故障，已确认记录仍可能丢失 |
| `all` / `-1` | 按 ISR 复制条件完成确认 | 仍需 min ISR、副本分布、选主和存储等条件，不等于全场景零丢失 |

4.1 Java 默认 acks 为 all。`min.insync.replicas` 是集群/Topic 侧的最低同步副本要求，不是 Producer 参数，也不是“每次最多只等这么多副本”。未启用 ELR 的旧配置形态还可能从 broker 默认值继承，应查询最终生效配置。

假设分区副本为 1/2/3，Leader 为 1，min ISR 为 2，Producer 使用 acks=all：

| 当前 ISR | 是否满足最低要求 | 正常情况下本次确认要满足的复制范围 |
| --- | --- | --- |
| 1/2/3 | 是 | 当前 ISR 的复制条件，不是随便两台先到就算成功 |
| 1/2 | 是 | 两个同步副本 |
| 1 | 否 | 拒绝按该可靠性要求正常完成写入 |

`NotEnoughReplicas` 与追加后副本不足等错误，还需要区分发生阶段；失败返回不意味着日志一定未曾追加。ISR 是动态集合，不能只看静态 replication.factor=3 就判断有三份同步数据。[Topic 的 min ISR 语义](https://kafka.apache.org/41/configuration/topic-configs/#min.insync.replicas)与[副本和选主](./04-副本ISR-Leader选举与KRaft.md)应一起理解。

Kafka 4.1 新建集群默认启用 Eligible Leader Replicas（ELR），会跟踪部分不在 ISR、但按其协议仍可安全选主的副本，并采用严格 min ISR 的 High Watermark 推进规则。它不是“允许任意落后副本做 unclean 选主”，也不把 acks=all 改成只等最低份数；启用后 min ISR 的集群级配置管理亦有专门限制，不能照搬旧 broker 级动态修改方式。升级集群的实际 feature 状态需另查，见[4.1 ELR](https://kafka.apache.org/41/operations/eligible-leader-replicas/)。

### 4.2 ACK 不是每条消息的 fsync 证明

Kafka 的复制确认不等于每个副本都为本条记录完成一次独立物理 fsync。OS 缓存、共同故障域、存储承诺、非同步副本选主和保留策略，仍会影响故障后的结果。强 ACK 无法防止错误业务数据，也不能替代异地灾备或恢复验证。

## 5. 重试与顺序

网络超时时 Producer 不知道请求是否已成功。重试可避免丢失，但传统模式可能重复；多个并发未确认请求还可能影响失败重试后的顺序。幂等 Producer 通过 producer identity、partition sequence 等机制让 broker 识别重试重复，并维护顺序约束。

幂等范围是单 Producer 会话向 Kafka partition 的写入，不等于业务端到端去重。进程重启、上游重复产生、跨系统副作用仍需要稳定 event ID。

### 5.1 幂等参数必须作为一组理解

| 参数 | Kafka 4.1 Java 默认值 | 幂等约束 |
| --- | --- | --- |
| `enable.idempotence` | `true`，但受冲突配置影响 | 显式设 true 可让冲突在初始化时暴露 |
| `acks` | `all` | 必须为 all |
| `retries` | 2147483647 | 必须大于 0；实际重试还受总投递时限限制 |
| `max.in.flight.requests.per.connection` | 5 | 必须不大于 5；不是一定要降到 1 才能有序 |

若显式启用幂等却配置 acks=1、retries=0 或 in-flight>5，会出现配置冲突。若没有显式启用而设置了冲突项，客户端可能关闭默认幂等；所以“默认 true”不能替代核对最终生效配置。

不启用幂等时，批次 A 先发送却失败、批次 B 后发送成功，A 重试成功后日志可能出现 B/A。幂等机制在允许的并发范围内识别协议级重试并维护顺序，但不把业务重复事件变成同一条协议记录。

例如同一个 `event_id=E1` 被应用主动调用 send 两次，这是两次合法发布，Kafka 不会按 payload 自动合并。事务 Producer 能提供另外一层事务边界，也不能永久记住所有业务 ID，详见[事务与 Exactly-Once 边界](./05-Kafka事务与端到端Exactly-Once.md)。

## 6. 超时体系

区分：元数据等待、batch 等待、请求超时、总投递时限和阻塞获取 buffer。总投递时限必须覆盖合理重试，却不能长到业务误认为成功。同步 `.get()` 会把异步 pipeline 变成逐条等待，吞吐骤降。

| 参数或等待点 | Kafka 4.1 Java 默认值 | 包含的范围 |
| --- | --- | --- |
| `max.block.ms` | 60000 毫秒 | send 等待元数据与分配缓冲等；不包含用户序列化器/分区器自身的执行时长 |
| `linger.ms` | 5 毫秒 | 主动凑批等待，不是网络超时 |
| `request.timeout.ms` | 30000 毫秒 | 一次请求等待响应的时间，不是整条记录只允许重试这么久 |
| `delivery.timeout.ms` | 120000 毫秒 | send 返回后的投递报告时限，覆盖排队、ACK 和允许的重试 |
| `future.get(timeout)` | 调用方指定 | 调用方等待结果的期限；超时不自动证明后台发送未成功 |

配置需满足 `delivery.timeout.ms >= linger.ms + request.timeout.ms`。它只是基本约束，不是“总超时 = max.block + linger + 每次请求时限”的固定流水线公式；批次已有到期时间、不可恢复错误等也可能提前失败。

`future.get` 已超时，随后立刻新发一个同事件 ID 的新记录，可能形成业务重复。反过来，真正的投递失败若仅被打印、不进入可追踪补偿，也会形成遗漏。先保存“已确认、失败、结果未知”的状态，再决定幂等重试或对账。[KafkaProducer API](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html)说明了发送、回调与会话幂等的边界。

## 7. 安全代码原则

- 序列化失败和超大消息立即失败；
- 回调记录 topic/partition/error 类别，不泄露 payload；
- 只有可重试错误自动重试，认证/授权/schema 错误快速失败；
- 关闭时 flush 并设置有界超时；
- 用 event ID 在下游校验，不能依赖 Kafka offset 作为跨 topic 唯一键。

下面是一份 Java Producer 的基础 properties 示例，不是 broker 配置。以已建好的隔离集群为前提；生产认证参数应从权限受控的配置中补充，不应因此关闭认证：

```properties
bootstrap.servers=127.0.0.1:19092
client.id=orders-producer-lab
key.serializer=org.apache.kafka.common.serialization.StringSerializer
value.serializer=org.apache.kafka.common.serialization.StringSerializer
acks=all
enable.idempotence=true
retries=2147483647
max.in.flight.requests.per.connection=5
batch.size=65536
linger.ms=5
buffer.memory=33554432
compression.type=lz4
request.timeout.ms=30000
delivery.timeout.ms=120000
max.block.ms=60000
```

这里 64 KiB 批次和 lz4 是实验选择，不是默认值或统一推荐；它们不能把 topic 的副本数/min ISR 自动改成所需值。Java 程序应加载此文件并处理每条异步结果；console producer 的参数与业务程序完成语义也需分别核对。

回调通常运行在 Producer I/O 路径上，不要在里面执行慢数据库调用或无界等待；把必要结果交给有界、可追踪的处理机制。`flush()` 等待先前发送完成，不等于逐条检查它们都成功；仍需处理 future/callback 中的异常。关闭应用时先停止新增发送，再在限定时长内处理在途结果与关闭资源。

## 8. 指标与实验

观察 send rate、request latency、record error/retry、batch size、compression ratio、buffer available/wait、metadata age。分别改变 batch/等待、acks 和压缩，固定输入记录与并发，比较吞吐、P99、CPU、网络和重复校验。

注入 broker 重启或短时断网，验证回调错误、重试、顺序和 event ID 唯一性。只在隔离环境进行。

| 现象 | 优先关联的证据 | 不应直接做的结论 |
| --- | --- | --- |
| send 调用变慢、buffer wait 上升 | 输入速率、Sender 吞吐、连接与 buffer-available-bytes | 只要加 buffer 就根治 |
| request latency、retry 上升 | Leader/ISR、网络、配额、broker 请求队列 | 一定是序列化慢 |
| 平均 batch 小、请求多 | 活跃分区数、linger、输入分布和 batch-size-avg | batch.size 大就自然会满批 |
| error 上升而 retry 不升 | 权限、序列化、消息尺寸与最终错误类别 | 所有错误都可无限重试 |
| 回调成功但下游重复 | event ID、主动重发、进程身份与消费重放 | enable.idempotence 失效 |

JMX 中可按 `kafka.producer:type=producer-metrics,client-id=...` 观察指标，区分客户端发送速率、重试率和业务完成率。比较同数据、同并发下的吞吐与 P99，再测试副本不足、响应丢失、缓冲耗尽等故障；不要在生产随意降低 ACK 做跑分。

## 9. 掌握验收

### 9.1 send 返回 future，记录已经到 broker 了吗？

答案：不一定。它可能只进入本地 Accumulator，之后才由 Sender 发送。应观察 future/callback 的最终结果；成功发送也不表示下游业务已经完成。

### 9.2 batching 为什么提高吞吐，又可能增加延迟？

答案：同分区多条记录合成批次可以摊薄协议、压缩与请求成本，但等待凑批和资源背压都会影响排队。batch.size 是字节目标，linger 是主动等待，两者都不直接限定每条记录端到端延迟。

### 9.3 三副本、min ISR=2，acks=all 是否只等两份？

答案：不是。min ISR 是最低门槛；当前 ISR 有三个时，正常确认仍按 ISR 复制条件进行，不是任意两份先到就完成。ISR 缩为一个时，不满足该最低写入要求；静态副本数不能代替当前同步状态。

### 9.4 为什么显式开启幂等，还不能任意设 retries 或 in-flight？

答案：4.1 Java 要求 `acks=all`、`retries>0`、`in-flight<=5`；冲突会导致配置异常。没有显式开启时，冲突设置可能让默认幂等关闭，应核对最终配置而不是只记默认 true。

### 9.5 同一 event ID 主动 send 两次会被自动合并吗？

答案：不会。协议级重试去重依赖 Producer 身份与分区序列号，主动新发是两条合法记录；业务事件级去重需要稳定 ID 和下游处理契约，进程重启及外部副作用也不由该开关自动覆盖。

### 9.6 future.get 超时后，可以认定消息没发出吗？

答案：不能。调用方等待期限与后台投递状态不同，原记录可能继续完成。应保留未知结果并查询/对账或幂等补偿，无条件新发可能制造重复。

### 9.7 send 卡住，是 request.timeout.ms 生效了吗？

答案：不一定。可能在等待元数据或缓冲，由 max.block.ms 等控制；也可能是用户序列化器自身很慢。请求响应、总投递报告和调用方 get 超时是不同边界。

### 9.8 buffer wait 上升，为什么不能只增大内存？

答案：若持续输入超过 Sender/broker/网络处理能力，加内存只延长排队并推迟爆发。应同时观察请求延迟、重试、配额、ISR、输入与发送速率，再判断瓶颈或实施背压。

上一篇：[Kafka 架构与分区日志](./01-Kafka架构分区日志Segment与索引.md)　下一篇：[Consumer Group、Offset、Rebalance 与顺序](./03-Consumer-Group-Offset-Rebalance与顺序.md)

## 10. 参考资料 {/* #参考资料 */}

- [Kafka 4.1 Producer Configuration](https://kafka.apache.org/41/configuration/producer-configs/)
- [Kafka 4.1 Topic Configuration](https://kafka.apache.org/41/configuration/topic-configs/)
- [Kafka 4.1 Eligible Leader Replicas](https://kafka.apache.org/41/operations/eligible-leader-replicas/)
- [KafkaProducer API](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html)
- [Kafka 4.1.0 ProducerConfig 源码](https://github.com/apache/kafka/blob/4.1.0/clients/src/main/java/org/apache/kafka/clients/producer/ProducerConfig.java)
