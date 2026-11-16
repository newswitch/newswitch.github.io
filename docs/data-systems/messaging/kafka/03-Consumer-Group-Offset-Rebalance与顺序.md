---
title: "Kafka Consumer Group、Offset、Rebalance 与顺序边界"
sidebar_label: "03. Kafka Consumer Group、Offset、Rebalance 与顺序边界"
sidebar_position: 3
description: "沿分区分配、poll、处理与提交解释消费位点，结合 Kafka 4.1 两种组协议、并发水位与命令输出分析重平衡、背压和积压。"
tags: [Kafka Consumer, Consumer Group, Offset, Rebalance]
---

# Kafka Consumer Group、Offset、Rebalance 与顺序边界

Consumer Group 让多个实例分担 partition。同一 group 中一个 partition 在稳定分配时由一个 consumer 成员处理；consumer 数超过 partition 数，多出的成员不会获得数据。

本文讨论 Apache Kafka 4.1 Java 普通消费组，使用 subscribe 加入组，不把 Share Group 等其他消费模型混进同一规则。默认协议为 classic；新 consumer 协议的分配与超时配置会另行区分。示例位点与输出用于教学，实际客户端和 broker 版本必须一起确认。

## 1. 拉取与分配

Consumer 获取集群元数据、加入 group、取得 partition assignment，再按 offset 发起 fetch。Group coordinator 管理成员、generation/epoch 和已提交 offset；不同组独立维护进度。

各组可分别读取仍保留且可见的记录，不是共享一份“取走即消失”的队列。一个组提交到 100，不会替另一个组确认 0～99，也不会因此让 broker 删除这些记录。

```text
subscribe → 入组/取得分区 → 确定起始位置 → fetch/poll
                                                ↓
                              应用处理 → 按分区提交完成水位
```

fetch 由客户端缓存并分批返回，poll 把记录交给应用，commit 记录恢复位置；这三个动作不能合并为“已经消费成功”。Java KafkaConsumer 不应被多个 worker 线程并发随意调用；通常由一个拥有者线程操作 Consumer，worker 回传完成信息。

## 2. Offset 的三种位置

| 位置 | 含义 | 是否代表业务已完成 |
| --- | --- | --- |
| Log End Offset，LEO | 副本日志下一追加位置，通常为末条日志 offset 加一 | 不代表所有追加已达到复制或事务可见条件 |
| Consumer position | 当前实例下一条准备交给应用的位置，poll 后可推进 | 不代表刚返回的记录已处理完 |
| Committed offset | 组保存的恢复起点，也采用下一位置语义 | 只有应用正确按完成水位提交时，才有相应业务含义 |

```text
lag ≈ log_end_offset - committed_or_current_position
```

这里必须注明使用 committed 还是 position、哪种末尾和隔离条件，不能混用来源。High Watermark 是复制可读边界，Last Stable Offset（LSO）还受未完成事务限制；read_committed 不会越过不稳定事务边界，可能暂时读不到更晚的记录。

例如一次 poll 返回 100～104，本地 position 已到 105，但业务可能一条都没完成，committed 仍为 100。若完成 100～102 后正确提交，应提交 103，不是 102；进程故障后从 103 恢复，剩余两条仍需处理。

offset 还可能因事务控制记录、过滤或压缩清理产生间隔，因此差值并不总等于待处理业务消息条数，更不能直接代表时间延迟。要同时记录事件时间/append 时间与处理完成时间；具体可见性见[Kafka 事务与读取隔离](./05-Kafka事务与端到端Exactly-Once.md)和[Consumer API](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)。

## 3. 提交与处理语义

先提交后处理可能丢；先处理后提交可能重复。生产常选择 At-Least-Once，加幂等 sink 或事务协调。自动提交简单但容易与实际业务处理完成时机脱节；手工同步/异步提交也要处理重试、generation 变化和乱序回调。

不要在处理尚未完成时提交更大 offset。并发处理同 partition 时，需要追踪连续完成水位，不能以“最快任务完成的 offset”覆盖中间未完成记录。

### 3.1 提交越过缺口，就可能漏掉未完成工作

假设这一批确实收到了分区 0 的五条记录 100～104，故障前已提交起点是 100。以下“可提交值”是安全恢复起点，不表示每完成一条都必须立即发一次网络提交：

| 新完成的记录 | 已完成集合 | 当前安全可提交值 |
| --- | --- | --- |
| 100 | 100 | 101 |
| 102 | 100、102 | 101 |
| 104 | 100、102、104 | 101 |
| 101 | 100、101、102、104 | 103 |
| 103 | 100、101、102、103、104 | 105 |

提交 105 时，Kafka 不会验证业务系统是否真的完成 101 和 103。若它们还没完成，消费者重启就会跳过这些输入。

实际实现按分区追踪已交付批次的完成顺序，不要等待日志中根本不存在或不可见的整数 offset 来“填满所有号码”。每个分区独立计算水位，不能拿分区 1 的最大 offset 推进分区 0。

### 3.2 同步、异步与自动提交不改变完成事实

| 方式 | 可以解决什么 | 不能自动解决什么 |
| --- | --- | --- |
| 自动提交 | 周期性保存客户端进度，默认开启，间隔默认 5000 毫秒 | 不知道外部 worker 或数据库事务何时完成 |
| `commitSync` | 等待提交结果，便于明确确认恢复点 | 不与外部业务提交组成原子事务 |
| `commitAsync` | 避免每次同步等待，回调处理结果 | 旧快照的应用级重试可能回退进度，不能无条件重发过期提交 |

对于多线程异步处理，常见选择是关闭自动提交，由 Consumer 拥有者线程汇总已完成水位。明确传入按分区计算的 offset；无参数提交若覆盖了已 poll 但未处理的记录，也会越过业务进度。提交失败时先判断是否仍拥有分区与当前 generation/epoch，不要无视重平衡一直重试旧状态。

业务成功、提交前崩溃会重放，外部数据库结果应按事件 ID 或适当的版本/唯一键幂等核验。Kafka 内 consume-transform-produce 的事务边界另见[Exactly-Once](./05-Kafka事务与端到端Exactly-Once.md)。

### 3.3 auto.offset.reset 不是日常重置开关

| 取值 | 没有有效已提交位置或位置越界时 |
| --- | --- |
| `earliest` | 从当前仍保留的起点开始，不是找回已清理历史 |
| `latest`，默认 | 从当时末尾开始，可能跳过此前保留的数据 |
| `none` | 抛错，让应用明确决定恢复路径 |

这里列出最常见的三种分支，其他版本选项按目标配置核对。已有合法 committed offset 时，改成 earliest 不会自动从头消费；真正重置需要明确的管理操作和停组/幂等评估，不应为“修复积压”直接改写生产位点。

## 4. Rebalance

成员加入/退出、订阅或 partition 变化、心跳/处理超时都可能触发重新分配。期间消费可能暂停，未提交记录会重放。协作式分配和静态成员身份可减少不必要迁移，但不能消除故障恢复。

慢处理要区分：poll 线程是否被业务阻塞、处理时限是否合理、心跳机制与客户端版本行为。常见模式是 poll 与 worker 解耦，并用 pause/resume 控制在途记录和背压。

### 4.1 classic 与 consumer 协议的配置归属不同

| 设置 | classic，4.1 默认协议 | consumer 协议 |
| --- | --- | --- |
| 协议选择 | `group.protocol=classic` | `group.protocol=consumer`，还需 broker 支持 |
| 分配器 | 客户端 `partition.assignment.strategy` 协商 | 服务端分配，客户端可通过 `group.remote.assignor` 选择受支持策略 |
| 心跳周期 | 客户端 `heartbeat.interval.ms`，默认 3000 毫秒 | broker 的 `group.consumer.heartbeat.interval.ms` |
| 会话超时 | 客户端 `session.timeout.ms`，默认 45000 毫秒，受 broker 允许范围约束 | broker 的 `group.consumer.session.timeout.ms` |
| poll 间隔限制 | `max.poll.interval.ms` 默认 300000 毫秒 | 仍须遵守 poll 活性要求，不能只靠后台心跳 |

不能切到新协议后继续靠旧 heartbeat/session 客户端参数调同一行为。classic 默认分配器列表含 Range 与 CooperativeSticky，默认优先 Range；出现 CooperativeSticky 名称不等于已经启用了协作式分配。[4.1 Consumer 配置](https://kafka.apache.org/41/configuration/consumer-configs/)说明了两种协议的参数归属。

静态成员 `group.instance.id` 必须在组内唯一，并对应稳定实例身份；多个 Pod 复制同一个值可能互相排斥。它能减少短暂重启造成的迁移，但也可能延后故障重分配。尤其静态成员超过 max.poll.interval 后，分区不一定立即分配给别人，还涉及停止心跳及会话超时。

### 4.2 分区撤销与丢失时如何处理 worker

收到撤销通知时，停止向被撤销分区派发新任务，在有限时间内汇总可安全提交的完成水位；不是阻塞整个组无限等待所有慢任务。协作式分配可能只撤销部分分区，不能错误清空仍属于自己的全部状态。

若分区已丢失，不能假定还能成功提交旧拥有者状态。后台旧 worker 也不会被 Kafka 自动终止，它仍可能向数据库写结果；需要取消/隔离过期任务，或借助业务幂等、版本判断等避免旧结果覆盖新结果。分区所有权、offset 提交资格和外部副作用是三个不同边界。

## 5. 顺序边界

Kafka 只保证 partition 日志顺序。要让同订单有序：producer 使用稳定 key；consumer 不跨 partition 假定全局顺序；若同 partition 内并发处理，要按 key 串行或在提交/输出处恢复顺序。

即使日志有序，CDC 多表事务、迟到网络事件和业务版本也可能造成语义乱序，应使用 source version/position 防旧状态覆盖新状态。

## 6. Backpressure 与积压

Consumer 可 pause partition，在下游恢复后 resume；也可限制 fetch 和在途任务。无限制拉取会堆积内存，完全停止 poll 又可能离组。设计有界队列、高低水位和明确丢弃/失败策略。

| 参数/动作 | Kafka 4.1 Java 基线 | 实际控制范围 |
| --- | --- | --- |
| `max.poll.records` | 500 条 | 每次 poll 返回上限，不是底层所有 fetch 缓存的条数上限 |
| `max.partition.fetch.bytes` | 1048576 字节 | 每分区 fetch 限额；为保证进展，首个非空分区的大批次可能突破它 |
| `fetch.max.bytes` | 52428800 字节 | 一次 fetch 响应的目标上限，同样不是进程总内存硬上限 |
| `pause/resume` | 应用主动操作已分配分区 | 停止/恢复该分区继续取数，不代替提交、不延长所有权 |

客户端可能向多个 broker fetch，worker 队列、反序列化对象和重试副本还占内存。降低 max.poll.records 不一定消除底层缓存峰值；需一起限制在途数量和字节，并在 pause 时继续按要求 poll 处理组协议。恢复前先确认分区仍归当前成员。

积压恢复时间估算：

```text
catch_up_time = backlog / (consume_rate - produce_rate)
```

只有消费能力大于持续生产，lag 才会下降。

例如实际待处理业务记录 600,000 条，持续输入每秒 3,000 条，可持续处理每秒 5,000 条，净追赶为 2,000 条/秒，理想估计约 300 秒。若吞吐被下游、热点分区或重试限制，这个估计会失效；若消费不超过生产，则没有有限追平时间。这里使用业务记录条数，不把所有 offset 差值直接当成同一计数口径。

## 7. 指标与排障

- records/bytes consumed、fetch latency/throttle；
- records lag max 与时间 lag；
- assigned partition、rebalance rate/duration；
- poll idle、处理队列、失败/重试/DLQ；
- commit latency/failure；
- 各 partition lag 分布而非 group 总和。

对已运行的隔离组做只读查询，生产认证通过权限受控的 `--command-config` 文件补齐：

```bash
bin/kafka-consumer-groups.sh --bootstrap-server 127.0.0.1:19092 --describe --group orders-worker
bin/kafka-consumer-groups.sh --bootstrap-server 127.0.0.1:19092 --describe --group orders-worker --state
```

普通 describe 的单分区教学输出可为：

```text
GROUP          TOPIC  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID   HOST        CLIENT-ID
orders-worker  orders 0          103             120             17   consumer-lab  /127.0.0.1  orders-c1
```

CURRENT-OFFSET 是工具读取的组提交位置，不是该进程的本地 position，也不是数据库成功处理数。LOG-END-OFFSET 是工具查询到的末尾指标，不能单独证明 Leader 所有本地追加都已达到复制和事务可见条件。此例报告差值 17；需要继续分辨在途、未投递、不可见记录和时间口径，不能见 17 就认定有 17 条业务失败。

| 现象 | 优先判断 |
| --- | --- |
| fetch 正常、处理队列增长 | 下游/worker 能力与完成水位，而不是只看网络 |
| local position 前进、committed 不动 | 正在处理还是提交失败，是否卡在某个分区缺口 |
| rebalance 频繁 | 成员抖动、poll 处理时长、身份/协议配置与协调器 |
| 仅一个分区 lag 大 | key 倾斜、热 key、单分区处理上限；加空闲 consumer 未必有效 |
| read_committed 像“卡住” | 未完成事务与 LSO，不仅是副本复制 lag |

## 8. 实验

用 4 partition topic 依次启动 1、2、4、6 个同 group consumer，记录分配与吞吐。处理后、提交前杀进程，观察重复；处理前提交再杀进程，观察丢失风险。用 event ID 和业务汇总验证，不只看日志。

一份 classic 协作式分配实验的 Consumer properties 可以是：

```properties
bootstrap.servers=127.0.0.1:19092
group.id=orders-worker
client.id=orders-c1
key.deserializer=org.apache.kafka.common.serialization.StringDeserializer
value.deserializer=org.apache.kafka.common.serialization.StringDeserializer
group.protocol=classic
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
enable.auto.commit=false
auto.offset.reset=earliest
isolation.level=read_committed
max.poll.records=100
max.poll.interval.ms=300000
heartbeat.interval.ms=3000
session.timeout.ms=45000
```

100 条是实验选择，不是默认值；earliest 只决定无有效位点时的起点。此文件不会替应用实现水位追踪和手工提交。新旧分配器混合升级、新协议迁移与静态身份要分别验证，不要直接把整组生产配置一次替换。

至少记录一次“业务已提交、offset 未提交”的故障，以及一次撤销分区时仍有 worker 运行的故障，核对重放与副作用。重置位点、停止进程和故障注入只在隔离实验执行；管理命令边界见[Kafka 命令手册](./13-Kafka-Topic-Producer-Consumer与Group命令手册.md)。

## 9. 掌握验收

### 9.1 position、committed 与日志末尾有什么区别？

答案：position 在 poll 交付后即可前进，committed 是故障恢复起点，日志末尾表示追加或工具查询口径下的终点。它们都不自动等于外部业务成功进度；事务还存在 HW/LSO 可见性边界，位点差也未必等于业务记录条数。

### 9.2 为什么 consumer 数超过 partition 不再线性加速？

答案：普通组在稳定分配时，一个分区只分给一个成员。四分区启动六个成员会有空闲成员；若瓶颈在单个热分区，增加成员也不会自动拆开该日志流。

### 9.3 并发完成 100、102、104，为什么只能安全提交 101？

答案：本例已交付的 101 尚未完成，提交更大值会使故障后跳过它。需按分区追踪已交付记录的连续完成前缀；等 101 完成可推进到 103，等 103 也完成才可到 105。

### 9.4 Rebalance 为什么会造成暂停与重复？

答案：成员/订阅/分区或活性变化会重新分配所有权，交接期间部分处理暂停；已做业务但未提交的记录在新拥有者上重放。应正确处理撤销/丢失、完成水位和旧 worker，协作式分配与静态身份只能减少部分迁移，不能消除恢复过程。

### 9.5 积压六十万条能否在五分钟内追平？

答案：持续生产每秒 3,000、稳定消费每秒 5,000 时，净追赶每秒 2,000，理想估计 300 秒；实际还受热点、重试和下游限制。消费不超过生产时无法在有限时间追平，不能直接使用无输入压测的峰值代入。

### 9.6 改 earliest 会让已有组从头读取吗？

答案：不会覆盖合法 committed offset。它用于没有有效提交位置或位置越界时，并且只能从仍保留的起点读；强制重置是另一项需评估重复/遗漏风险的管理操作。

### 9.7 心跳正常，为什么仍可能因处理慢失去分区？

答案：会话存活与 max.poll.interval 的应用活性约束不同，后台心跳不能无限掩盖不再 poll。新 consumer 协议的心跳/会话参数由 broker 控制；静态成员超 poll 间隔后的重分配时序还可能等会话超时。

### 9.8 max.poll.records=100，为什么内存仍可能很高？

答案：它限制每次 poll 返回数，不限制所有 fetch 缓存、反序列化对象和 worker 队列。还需按字节与在途数量做有界背压，理解 fetch 首批大记录的例外与多 broker 并发。

### 9.9 分区转交后，旧 worker 的写入会被 Kafka 自动取消吗？

答案：不会。Kafka 管组所有权与提交资格，不控制已经发往外部数据库的操作。应用需识别过期任务、限制副作用，并使用幂等/版本等契约；不能以旧 generation 继续推进位点。

上一篇：[Producer Batching、Acks 与幂等](./02-Producer-Batching-Acks重试与幂等.md)　下一篇：[副本、ISR、Leader 选举与 KRaft](./04-副本ISR-Leader选举与KRaft.md)

## 10. 参考资料 {/* #参考资料 */}

- [Kafka 4.1 Consumer Configuration](https://kafka.apache.org/41/configuration/consumer-configs/)
- [KafkaConsumer API 与多线程边界](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)
- [Kafka 4.1.0 ConsumerConfig](https://github.com/apache/kafka/blob/4.1.0/clients/src/main/java/org/apache/kafka/clients/consumer/ConsumerConfig.java)
