---
title: "Streams、Pub/Sub、可靠队列与 Kafka/RocketMQ 对比"
sidebar_label: "13. Streams、Pub/Sub、可靠队列与 Kafka/RocketMQ 对比"
sidebar_position: 13
description: "沿消息写入、投递、PEL、接管和确认理解 Streams，结合完整输出解释幂等、积压、修剪和可靠性边界。"
tags: [Redis, Streams, PubSub, Kafka, RocketMQ]
---

# Streams、Pub/Sub、可靠队列与 Kafka/RocketMQ 对比

Pub/Sub 是在线广播：订阅者离线期间的消息不会为它积压，也没有消费确认和按历史位置重放。Streams 则把 entry 存入有序数据结构，可以独立读取历史，并用 consumer group（消费组）记录投递与确认状态。

但“写进 Stream”“分给消费者”“业务完成”“Redis 收到 ACK”是四件不同的事。可靠消费的关键不是多调用一个 XACK，而是理解这些状态之间的故障窗口。

本文以 Redis Open Source 8.6 为基线。`XAUTOCLAIM` 自 6.2 提供，7.0 起返回清理的已删除消息 ID；修剪引用策略自 8.2 提供。示例使用传统的显式接管路径，命令和教学输出不依赖更新版本才提供的选项。

## 1. Streams 路径 {/* #streams-路径 */}

### 1.1 一条消息有三层状态

| 层次 | 保存什么 | 不代表什么 |
| --- | --- | --- |
| Stream 本体 | ID、字段和值，按 ID 排序 | 存在不代表任何业务已处理 |
| Consumer group | 组的读取进度、消费者及 PEL | 一个组完成不代表其他组也完成 |
| 业务系统 | 订单、扣款、索引等实际结果 | Redis 无法仅靠 XACK 校验外部业务事务 |

PEL 是 Pending Entries List，保存“已投递给这个组的消费者，但尚未确认”的引用及相关状态，不是另一份独立可靠的消息正文备份。

```text
生产者 XADD → entry 留在 Stream
                  ↓
消费组 XREADGROUP → 分配给 c1，并进入该组的 PEL
                  ↓
业务处理并提交结果
                  ↓
XACK → 从该组的 PEL 移除；entry 默认仍留在 Stream
```

同一消费组通常用于分工，一条新消息交给组内某个消费者；两个独立组则各有读取进度与确认状态。普通 `XREAD` 读取历史不会自动获得消费组的分工和 PEL 能力。

### 1.2 先业务还是先 ACK，差别在哪里

| 故障窗口 | Redis 侧状态 | 恢复时的业务风险 |
| --- | --- | --- |
| 先 XACK，业务尚未提交就崩溃 | PEL 已移除 | 常规 Pending 恢复找不到这条任务，可能漏处理 |
| 业务提交后，XACK 前崩溃 | 仍在 PEL | 接管者会重做，可能重复产生业务效果 |
| XACK 已执行，但响应丢失 | 调用方不知道是否成功 | 重试 ACK 本身可接受，不能因此无条件重做外部业务 |

常见做法是先提交可幂等的业务结果，再确认消息。例如把“订单状态修改”和“唯一业务事件 ID 的处理记录”放入同一个数据库事务，重复投递时检查同一唯一键，不再重复扣款。若生产者会为同一个业务事件生成多个 Stream ID，仅按 Stream ID 去重就不够。

这得到的是在保留、恢复和消费者正确运行等前提下的重投递与效果去重，不是 Redis 和外部数据库组成了一个全局 exactly-once 事务。HTTP 请求、支付等外部副作用，还需要下游幂等键或可核验结果。

### 1.3 重新读取不等于接管

| 请求方式 | 主要读取什么 | 是否解决其他消费者的遗留 Pending |
| --- | --- | --- |
| `XREADGROUP ... STREAMS key >`，不带 CLAIM | 这个组尚未投递的新消息 | 不会自动重投给别人的 Pending |
| `XREADGROUP ... STREAMS key 0` | 当前消费者自己的 Pending 历史 | 不能直接拿走别人的 Pending |
| `XPENDING` | 未确认状态、归属、idle 和投递次数 | 只查询，不搬动所有权 |
| `XCLAIM` | 显式 ID 的接管 | 满足条件后转移归属 |
| `XAUTOCLAIM` | 按游标扫描并接管符合 idle 条件的 Pending | 适合分批恢复，仍需后续处理与确认 |

`NOACK` 会让投递跳过 PEL 记录，不适用于依赖 Pending 找回任务的处理链。Redis 8.4 起 `XREADGROUP` 也可显式使用 `CLAIM` 选项，但不能据此认为所有只写 `>` 的旧消费循环都会自动回收任务。协议与版本差异见[XREADGROUP](https://redis.io/docs/latest/commands/xreadgroup/)。

## 2. 保留与积压 {/* #保留与积压 */}

### 2.1 lag、Pending 和 XLEN 不是同一个积压

| 指标 | 回答的问题 | 注意点 |
| --- | --- | --- |
| `XLEN` | Stream 本体当前保留多少 entry | 已 ACK 的 entry 仍可能计入长度 |
| `XINFO GROUPS` 的 `lag` | 组还有多少消息尚未投递 | 某些进度/删除条件下可能无法计算，不能把未知当成 0 |
| `XINFO GROUPS` 的 `pending` | 已投递、尚未确认多少 | lag 为 0 时，Pending 仍可能很大 |
| `XPENDING` 扩展输出的 idle | 某条 Pending 多久没有重新投递/接管 | 不是业务执行耗时的精确计时器，也不是 entry ID 的年龄 |
| 投递次数与业务失败数 | 是否反复重试、存在毒消息 | Redis 投递计数不等于业务实际执行次数 |

组 lag 持续增长而 Pending 不多，可能是读取能力不足；lag 很低但 Pending 大、最老 idle 增长，可能是处理失败或确认路径有问题。`XINFO CONSUMERS` 的消费者空闲状态还需结合客户端存活与实际业务进度，不能只看一个 idle 字段就认定进程死亡。组指标定义见[XINFO GROUPS](https://redis.io/docs/latest/commands/xinfo-groups/)。

容量也要按时间算。每秒 1,000 条、保留 1 小时，仅按每条 1 KiB 有效载荷计算，就是 3,600,000 条、约 3.43 GiB；还未计入数据结构、PEL、复制、持久化与 fork 期间额外内存。`XLEN` 小不等于占用字节少，更不等于主机仍有安全余量。

### 2.2 MAXLEN 与 MINID 控制什么

`MAXLEN` 按条数修剪，`MINID` 按 ID 下界修剪。`=` 倾向精确阈值，`~` 允许按内部块近似处理以减少开销；`LIMIT` 用于限制近似修剪的检查工作量，不是消息保留时长。

`MINID` 也不是给每条消息设置 TTL。只有在 ID 生成规则与业务保留语义相符时，才能把 ID 的毫秒部分用作时间窗口；自定义 ID、时钟和重放来源都需要考虑。精确修剪可能做更多工作，近似修剪则不能用作严格的字节上限。

### 2.3 默认修剪不等待消费者处理完

Redis 8.2 起，XTRIM 的引用策略可以明确选择：

| 策略 | 本体如何修剪 | PEL 如何处理 | 风险或代价 |
| --- | --- | --- | --- |
| `KEEPREF`，默认 | 按阈值修剪，不等待消费确认 | 已有 Pending 引用保留 | 留着 ID 不代表正文还在，恢复可能拿不到内容 |
| `DELREF` | 按阈值修剪 | 同时移除对应 Pending 引用 | 既丢正文，也丢相应未确认记录，不能称为成功消费 |
| `ACKED` | 只允许修剪已被所有消费组读取且确认的条目 | 不靠删除未完成任务来腾空间 | 慢组可阻止修剪，长度可能高于目标，需另做容量治理 |

例如 `XTRIM lab:orders MAXLEN ~ 100000 ACKED` 表达“尝试保留约十万条，但不能越过所有组确认的边界”，不是“内存保证不再增长”。默认 KEEPREF 则可能删除尚未投递或尚未处理的内容。完整条件见[XTRIM](https://redis.io/docs/latest/commands/xtrim/)。

若保留窗口短于最慢消费者加故障恢复所需时间，后续补一个 ACK 也无法找回已删正文。Redis 7.0 起 XAUTOCLAIM 会报告扫描到并从 PEL 清理的已删除 entry ID；这应作为数据缺口证据处理，不能当作已经成功补偿。

## 3. 与专业消息系统比较 {/* #与专业消息系统比较 */}

| 维度 | Redis Streams | Kafka/RocketMQ |
| --- | --- | --- |
| 运行形态 | 可复用 Redis，但消息负载会与缓存争抢资源 | 通常需要独立管理消息集群 |
| 长期积压 | 内存容量与持久化开销需要单独规划 | 重点评估磁盘日志、保留与回放能力 |
| 分区与扩展 | 通常把业务拆成多个 Stream；单 Stream key 仍属一槽 | Kafka 分区、RocketMQ Queue 等机制需按各自模型设计 |
| 消费恢复 | 组、PEL、接管和幂等由应用正确组合 | 也要理解重试、确认、顺序与重复边界，不能只换产品 |
| 与 Redis 数据组合 | 同实例/同槽的事务或脚本可协调部分本地状态 | 跨业务数据库的副作用仍需应用协调 |

选型时先说明吞吐、最大积压、保留时间、重放、跨地域与故障恢复要求，再比较产品。不能只因“已经有 Redis”就让缓存与关键任务共用一套没有容量隔离的资源，也不能把换成 Kafka/RocketMQ 当成业务自动获得 exactly-once。

Streams 本身的消费协议不替代 Redis 的持久化和复制。`XADD` 成功后能承受哪种故障，仍取决于[RDB/AOF](../02-engine-persistence/07-Redis-RDB-AOF-fork与Copy-on-Write.md)、[复制与确认](../03-ha-cluster/08-Redis主从复制PSYNC与一致性.md)。过期策略或 `allkeys-*` 淘汰还可能删除整个 Stream key，连同消费组状态一起消失，详见[内存、过期与淘汰](../02-engine-persistence/06-Redis内存过期与淘汰.md)。

## 4. 可靠消费实验 {/* #可靠消费实验 */}

### 4.1 准备唯一测试键，先创建消费组

只在隔离测试实例操作，并确认 `lab:orders` 不存在；若已存在，换一个新的测试键，不要删掉真实 Stream 或已有消费组来重跑。下面用 `redis-cli -p 16379` 进入交互会话，输出为可推演的教学状态，不是一次真实服务运行记录。

```text
127.0.0.1:16379> XGROUP CREATE lab:orders workers 0 MKSTREAM
OK
127.0.0.1:16379> XADD lab:orders 1000-0 order_id 1001
"1000-0"
```

`MKSTREAM` 在键不存在时创建空 Stream；`0` 表示从组进度起点读取已有消息。若创建组时使用 `$`，则从创建时的尾部开始，只读此后的新消息，之前的历史不会自然进入这组的普通新消息读取路径。

这里故意用固定 ID `1000-0` 便于对照，且只向全新测试键写入；生产通常用 `XADD ... *` 让服务器生成 ID。ID 必须单调递增，但它不是接管判断所用的 idle 计时器。

### 4.2 c1 取走消息，却没有确认

```text
127.0.0.1:16379> XREADGROUP GROUP workers c1 COUNT 1 BLOCK 2000 STREAMS lab:orders >
1) 1) "lab:orders"
   2) 1) 1) "1000-0"
         2) 1) "order_id"
            2) "1001"
127.0.0.1:16379> XPENDING lab:orders workers
1) (integer) 1
2) "1000-0"
3) "1000-0"
4) 1) 1) "c1"
      2) "1"
```

Pending 汇总依次表示总数、最小 ID、最大 ID、各消费者持有数。此时假设 c1 在业务完成前失联；不要 ACK。让另一个消费者只读新消息：

```text
127.0.0.1:16379> XREADGROUP GROUP workers c2 COUNT 1 BLOCK 2000 STREAMS lab:orders >
(nil)
```

等待约 2 秒后没有新消息，所以返回空；c1 的 Pending 不会因为 c2 启动就自动变成普通新消息。若从 shell 而非交互终端发送命令，要把 `>` 写成引号包围的 `'>'`，避免 shell 把它当成输出重定向。

### 4.3 先确认 idle，再由 c2 接管

在该 entry 距离上次投递超过 60 秒、且期间没有重新读取或接管时，可能看到以下扩展状态。61,000 毫秒及接管后的 20 毫秒都是教学采样值，实际运行会不同：

```text
127.0.0.1:16379> XPENDING lab:orders workers - + 10
1) 1) "1000-0"
   2) "c1"
   3) (integer) 61000
   4) (integer) 1
127.0.0.1:16379> XAUTOCLAIM lab:orders workers c2 60000 0-0 COUNT 10
1) "0-0"
2) 1) 1) "1000-0"
      2) 1) "order_id"
         2) "1001"
3) (empty array)
127.0.0.1:16379> XPENDING lab:orders workers - + 10
1) 1) "1000-0"
   2) "c2"
   3) (integer) 20
   4) (integer) 2
```

`XPENDING` 的四项分别是 ID、当前消费者、idle 毫秒数、投递次数。`XAUTOCLAIM` 的参数与返回要分开理解：

| 项目 | 本例 | 含义 |
| --- | --- | --- |
| 目标消费者 | `c2` | 接管后的归属，不是验证进程活着的凭证 |
| min-idle-time | `60000` | 毫秒阈值，只接管足够久未再次投递/接管的 Pending |
| 扫描起点 | `0-0` | 从 PEL 开头扫描，不是把消费组历史进度重置 |
| COUNT | `10` | 尝试接管的批次上限；内部最多扫描其 10 倍的 Pending，不保证拿到 10 条 |
| 返回第一项 | `0-0` | 这次扫描到了 PEL 尾部，不代表 PEL 已经为空 |
| 返回第二项 | 一条消息 | 本次成功接管的正文，要继续完成业务与 ACK |
| 返回第三项 | 空数组 | 没遇到正文已删除、需从 PEL 清理的 ID |

接管会重设相应 idle，通常增加投递计数；使用 `JUSTID` 时只返回 ID 且不增加该计数。实际循环应携带返回游标分批扫描，不能每次都只从头处理第一批，也不能因为某次消息数组为空就认为没有后续 Pending。[XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/)定义了游标、扫描和删除引用的行为。

最重要的是：把 PEL 归属改为 c2，不会中断已经在 c1 进程里运行的代码。如果 c1 只是长暂停而非死亡，它恢复后仍可能写外部数据库，甚至发送 ACK。因此接管阈值应结合业务处理时长与可观察进度设计，不能把 idle 当作分布式锁，也不能省略业务去重。

### 4.4 业务完成后 ACK，再看正文是否还在

假设 c2 已核验幂等记录并提交业务事务，再执行：

```text
127.0.0.1:16379> XACK lab:orders workers 1000-0
(integer) 1
127.0.0.1:16379> XPENDING lab:orders workers - + 10
(empty array)
127.0.0.1:16379> XLEN lab:orders
(integer) 1
127.0.0.1:16379> XRANGE lab:orders 1000-0 1000-0
1) 1) "1000-0"
   2) 1) "order_id"
      2) "1001"
127.0.0.1:16379> XACK lab:orders workers 1000-0
(integer) 0
```

第一次 ACK 移除一条 Pending，第二次没有可移除记录而返回 0，不代表业务失败。正文仍然保留，之后可以通过历史查询或其他组读取；ACK 不是删除消息，也不会把其他组标成完成。

### 4.5 毒消息、死信和重试上限

恢复程序不能永远 claim 同一条解析错误消息。应记录业务失败原因、重试次数、首次失败时间，并在超过策略上限后转入可追踪的死信路径。

但“先 XADD 死信，再 XACK 原消息”中间若崩溃，可能重复产生死信；反过来先 ACK 又可能丢掉待调查的任务。死信标识应能去重，本地转存与确认需要设计协调边界；若依赖 Redis 事务或脚本，Cluster 下相关键还必须同槽，且 Redis 本地协调不能同时提交外部数据库事务。相关原理见[Pipeline、事务与 Lua](../01-client-data/02-RESP客户端连接Pipeline事务与Lua.md)。

告警至少应包含组 lag、Pending 数与最老 idle、业务失败率、接管频率、已删正文 ID、Stream 内存/增长率和生产者写入错误。只看 `XLEN` 或“消费者进程还活着”，都不足以证明队列正常。

## 5. 验收题 {/* #验收题 */}

### 5.1 Pub/Sub 订阅者离线会怎样？

答案：离线期间的消息不会为它保留，重新订阅也不会补发历史。它适合允许丢失或能从其他权威状态重新同步的通知；需要离线积压、确认和重放时，必须选择相应存储与消费协议。

### 5.2 Pending 与 ACK 分别代表什么？

答案：Pending 表示已投递给该组消费者、尚未确认；ACK 只是移除该组的 Pending 引用，不替 Redis 验证业务已提交。先 ACK 后业务可能漏处理，先业务后 ACK 可能重复，因此要把实际效果设计为可幂等核验。

### 5.3 如何恢复长期 idle consumer 的消息？

答案：先用 XPENDING 观察归属、idle 和投递状态，结合业务耗时判断是否需要接管；用 XAUTOCLAIM 携带游标分批扫描，完成幂等业务后再 ACK。游标 0-0 表示本轮扫描结束，不表示已确认全部 Pending；其他消息也可能稍后才达到 idle 阈值。

### 5.4 Stream 修剪为什么可能破坏重放？

答案：正文可能在慢消费者处理前就被删除，默认 KEEPREF 还会留下没有正文的 Pending 引用。保留窗口必须覆盖消费与恢复时间；选择 ACKED 可以约束删除条件，但慢组可能阻止释放内存，仍需容量上限与异常处理策略。

### 5.5 XACK 成功后，XLEN 为什么没有减少？

答案：ACK 管理组的 Pending，XLEN 统计 Stream 本体 entry，两者不是同一份状态。正文需要按独立保留策略修剪或删除；组 A 的 ACK 也不会让组 B 自动完成。

### 5.6 c2 只读 >，为什么拿不到 c1 未完成的消息？

答案：不带 CLAIM 的普通新消息读取只取该组尚未投递的 entry，c1 的消息已进入 Pending。c1 可以读取自己的 Pending，其他消费者需要显式接管；重启消费进程不等于重置服务端状态。

### 5.7 XAUTOCLAIM 后，为什么仍可能重复扣款？

答案：接管只修改 Redis 中的归属，不会取消旧消费者已执行或正在执行的外部操作。c1 可能业务已提交却没 ACK，也可能暂停后恢复；需要业务唯一事件 ID、原子去重记录或下游幂等，不能把 PEL 当作排他执行锁。

### 5.8 使用 ACKED 修剪，能保证内存不超限吗？

答案：不能。未被所有组读取并确认的数据会约束修剪，慢组或死组可让长度持续超目标；单条消息大小、PEL 和持久化开销也不由条数直接限制。需要处理消费能力、组生命周期、背压、字节容量与故障恢复，不应通过悄悄丢任务来伪装解决积压。

## 6. 参考资料 {/* #参考资料 */}

- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)
- [Pub/Sub](https://redis.io/docs/latest/develop/pubsub/)
- [XREADGROUP：读取模式与版本选项](https://redis.io/docs/latest/commands/xreadgroup/)
- [XPENDING：未确认消息查询](https://redis.io/docs/latest/commands/xpending/)
- [XAUTOCLAIM：游标接管与已删除消息处理](https://redis.io/docs/latest/commands/xautoclaim/)
- [XACK：移除消费组 Pending](https://redis.io/docs/latest/commands/xack/)
- [XINFO GROUPS：组进度与 lag](https://redis.io/docs/latest/commands/xinfo-groups/)
- [XTRIM：修剪和引用策略](https://redis.io/docs/latest/commands/xtrim/)
