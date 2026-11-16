---
title: "MirrorMaker 2、跨集群复制、灾备切换与一致性"
sidebar_label: "11. MirrorMaker 2、跨集群复制、灾备切换与一致性"
sidebar_position: 11
description: "从 MM2 三类 Connector、远端命名、offset-sync 与 checkpoint 解释跨集群复制，结合 Kafka 4.1 配置和位点算例分析切换、重放与回切。"
tags: [Kafka, MirrorMaker 2, Disaster Recovery]
---

# MirrorMaker 2、跨集群复制、灾备切换与一致性

跨数据中心通常使用各自独立的 Kafka 集群，再通过跨集群复制连接。把同一个 controller/broker 的关键复制路径直接拉过高延迟 WAN，会把链路延迟与分区故障带进集群内的可用性条件；但独立集群之间的异步复制也不是同步提交。

MirrorMaker 2（MM2）基于 Kafka Connect。它把消息、消费位置映射和连通性信号分别处理，不是直接复制 broker 数据目录，也不是复制一份可原样接管的 `__consumer_offsets`。

本文以 Apache Kafka 4.1 为主线，关键转换逻辑核对 `4.1.0` 源码。A 是源集群、B 是目标集群；配置、事件与位点为教学示例，不能把这些数值当作真实灾备测量结果。

```text
A 中的 orders → MirrorSourceConnector → B 中的 A.orders
             └─ 记录源/目标的 offset-sync 映射
A 的组提交位置 + offset-sync → MirrorCheckpointConnector
                              ├─ B 中的 checkpoint
                              └─ 可选写入 B 的组提交位置
MirrorHeartbeatConnector → 连通性/复制拓扑信号
```

| 组件 | 主要职责 | 不代表什么 |
| --- | --- | --- |
| MirrorSourceConnector | 读取源消息，写远端 topic，并提供记录位置映射 | 目标已完成全部业务消费 |
| MirrorCheckpointConnector | 把源组的进度转换为目标位置，生成 checkpoint，按配置同步目标组位点 | 所有目标组都能随时被覆盖进度 |
| MirrorHeartbeatConnector | 周期产生 heartbeat，辅助观察连通和拓扑 | 每个业务分区复制都无积压 |

## 1. Topic 命名 {/* #topic-命名 */}

默认 `DefaultReplicationPolicy` 使用源 alias 和分隔符命名：A 的 `orders` 在 B 成为 `A.orders`，默认分隔符为点号。这样 B 本地的 `orders` 与来自 A 的历史不是同一个 topic，也便于识别来源和避免复制环路。

| 拓扑 | B 中数据 | 必须明确的边界 |
| --- | --- | --- |
| A→B 单向 | 本地 orders 与远端 A.orders 可并存 | 应用切换不能只改 bootstrap，订阅名也需正确 |
| A↔B 双向、默认命名 | 各有本地流与对方的远端流 | 默认来源识别/过滤不是跨集群全局顺序或冲突合并 |
| 使用同名/自定义策略 | 可能没有来源前缀 | 要额外处理名称冲突、数据归属、环路和位点转换策略一致性 |

Active-Passive 较容易建立单一写入权威。Active-Active 需要定义业务 key 的写入归属、旧版本覆盖规则与冲突处理；两边同时改同一订单，MM2 不会自动变成一个跨集群事务数据库。

Source 与 Checkpoint Connector 必须使用一致的 replication policy、alias 和 separator，否则数据可能写入一个名字、位点却转换到另一个名字。不要临时去掉前缀来“方便切换”后继续沿用旧 checkpoint。配置含义见[MirrorMaker 配置](https://kafka.apache.org/41/configuration/mirrormaker-configs/)。

## 2. Offset {/* #offset */}

### 2.1 三种位置记录不要混在一起

| 对象 | 保存什么 | 常见位置/用途 |
| --- | --- | --- |
| offset-sync | 某源分区记录 offset 与已写入目标记录 offset 的对应关系 | 供位点转换，不一定每条都有映射 |
| checkpoint | 某消费组的源提交位置与转换后的目标恢复位置 | 写入目标 checkpoint topic，默认命名如 A.checkpoints.internal |
| 目标组 committed offset | B 中消费者实际使用的恢复位置 | 只有完成同步/受控设置后，目标组才会按它恢复 |

因此“数据复制到了”“有 checkpoint”“B 的组已设置到正确起点”是三个条件。源与目标自己的日志都有独立历史，不能把源 committed=105 原样填进目标 A.orders=105。

### 2.2 用一个稀疏映射手算转换

假设某个源分区仅找到有效映射 `A.orders-0:100 → B.A.orders-0:500`，而组提交的是下一待处理位置，不是最后完成记录。对这个映射附近，4.1.0 的 OffsetSyncStore 采用保守转换：

| 源组 committed | 在本例可用映射下的目标位置 | 含义 |
| --- | --- | --- |
| 100 | 500 | 源记录 100 仍是下一待处理记录，目标从对应记录开始 |
| 101 | 501 | 已处理源 100，目标从其后开始 |
| 105 | 501 | 不把未知区间直接线性外推为 505，可能重读部分记录 |
| 99 | 无有效可用转换 | 现有映射晚于所需历史，不能自行把结果当成 0 |

在这个条件下，逻辑是“恰好命中映射点取对应目标位置，否则最多前进一个目标位置”，而不是 `target = source + 固定差值`。实际会先选择适用的已保留映射；映射存储尚未完成初始化或没有匹配信息时，也可能暂时不能转换。

原因是源区间中可能有过滤、控制记录或其他位置差异，MM2 不能仅凭两个编号假定每个源位置都产生恰好一个目标位置。保守重读比越过尚未处理记录更安全，但应用仍需幂等。[4.1.0 OffsetSyncStore](https://github.com/apache/kafka/blob/4.1.0/connect/mirror/src/main/java/org/apache/kafka/connect/mirror/OffsetSyncStore.java)给出了该分支。

例如仅在本教学数据段中，源 100～109 恰好逐条写成目标 500～509，源组已处理到 104、提交 105。若仍只有 100→500 这个可用映射，目标从 501 恢复，会重读源 101～104 对应的四条，再处理 105 之后的记录。这不是“每次必重放四条”，而是说明稀疏映射、checkpoint 年龄与业务去重共同影响切换效果。

### 2.3 自动同步为何不能覆盖正在消费的组

`emit.checkpoints.enabled=true` 默认生成 checkpoint，不等于 `sync.group.offsets.enabled=true`。后者默认 false；开启后才周期性尝试把转换位置写入 B 的组进度，并要求目标组没有活跃消费者等条件。

对于已有目标位置，4.1.0 的同步还会避免用较小的转换位置覆盖更大的目标提交。因而源组做了回退，也不能假定目标自动一起回退；必须检查实际组状态与最终提交结果。[MirrorCheckpointTask](https://github.com/apache/kafka/blob/4.1.0/connect/mirror/src/main/java/org/apache/kafka/connect/mirror/MirrorCheckpointTask.java)体现了组状态、已有位点和提交失败的处理。

目标组“空闲”指没有活跃成员，不是有一个成员但暂时没有 poll 到消息。启动目标消费者后再等 MM2 强行改位点，不是可靠的切换顺序。

## 3. 一致性 {/* #一致性 */}

跨集群异步复制存在 RPO。网络中断、Connector 停止和目标限流都会增加 lag；重复可能发生，顺序只在特定 partition 流内讨论。

### 3.1 数据、恢复点和业务结果分别确认

源 Producer 获得 acks=all，通常只证明源集群满足对应复制条件，并不包含 B。灾难发生时，还没复制到 B 的已确认事件可能不可恢复；源消费组已提交、checkpoint 仍旧时，则可能在 B 重放部分已完成业务。

数据复制 lag、checkpoint 年龄、目标组同步结果与目标业务完成率都要分别观察。Heartbeat 新鲜最多说明相应信号路径还在工作，不能证明所有 Source task、分区和 Checkpoint task 都正常。

源事务数据的隔离也要明确。若不希望把 aborted 数据当成普通记录复制，源读取应使用 `read_committed`；它仍不会把源跨分区事务边界自动原样搬成目标的同一业务事务。

### 3.2 MM2 支持 EOS，但不是跨集群同步提交

MM2 的专用运行模式自 3.5 起支持相应的 exactly-once source 能力；它需要 Connect worker、目标事务写入和内部协调等配置，不能仅给 Producer 开幂等就当成 MM2 EOS。4.1 专用模式相关设置包括目标 alias 的 `exactly.once.source.support=enabled`，以及内部 REST 协调；已有集群还涉及 preparing→enabled 的分步升级。

这类能力针对 Connect 的目标写入与源处理位置协调，减少故障重试产生的重复；不让 A 的业务提交必须等待 B，也不覆盖任意数据库副作用、全部原事务语义或应用主动重复发布。内部 REST 若启用还要安全隔离，不能为了一个开关暴露管理端口。详见[官方 MM2 EOS 条件](https://kafka.apache.org/41/operations/geo-replication-cross-cluster-data-mirroring/#exactly-once)。本节后面的基础示例不声明已经启用 EOS。

## 4. 切换 {/* #切换 */}

```text
计划切换：停止/围栏旧写入口，停止源消费并确认安全提交位置
  → 保留 MM2 运行，核对数据复制与 checkpoint
  → 目标组尚未启动时，验证转换后的实际恢复位置
  → 衔接镜像历史与目标新写，按约定启动业务
  → 逐事件核对缺口、重复、顺序和延迟
```

### 4.1 计划切换与源突然损毁不同

计划切换可以停止新写后等待复制收敛；源突然损毁时，不能再要求故障源提供最新提交和缺失消息。此时只能基于事前保留的确认流水、目标数据与可用 checkpoint 判断缺口，缺少证据就不能宣称 RPO=0。

写入围栏还要覆盖旧消费者触发的外部副作用。只把 DNS 改到 B，并不意味着仍连接 A 的旧实例已经停写；权限、应用租约或其他可验证机制必须真正限制旧权威继续产生修改。

### 4.2 默认命名下，新写不自动接在镜像 topic 后面

在 B，`A.orders` 是镜像流，而 `orders` 可以是本地新写流。不能只改 bootstrap 后假定应用自动先读镜像历史、再读新写；直接向镜像 topic 发业务写，也可能违反只读镜像、ACL 与复制契约。

一种明确的衔接方式是先处理完约定的镜像历史边界，再在完成业务顺序屏障后切到 B 的本地流；也可以使用经过验证的应用路由/命名方案。无论哪种，同一个业务 key 跨两个 topic 的先后不能凭 Kafka 自动保证，需处理未完成任务、事件版本与重复。

### 4.3 回切要处理 B 期间的新增历史

回切前建立受控反向复制或差异同步，确定权威写入口与数据收敛位置，再进行消费者位置和流命名衔接。不是 A 修好了就把客户端指回去：B 上的新写、外部数据库结果和旧 A 尚未围栏的修改，都可能与原历史不同。

启用反向流也不是自动解决冲突。需遵守相同的命名/环路规则，并验证去重、旧版本覆盖和两侧提交位置；不能把一个错误的目标较大 offset 当成已经完成全部业务的证明。

## 5. 灾备演练：先定义数据契约 {/* #灾备演练先定义数据契约 */}

### 5.1 用一份单向配置明确关键分支

下面是 `connect-mirror-maker.sh` 专用模式的基础配置示例，假设 A、B 都有至少三个可用 broker，并已正确配置访问权限。回环 bootstrap 仅是测试入口；其他被发现的 advertised 地址也须可达。文件不含真实凭证，生产连接应分别补齐 consumer/producer/admin 的认证配置。

```properties
clusters=A,B
A.bootstrap.servers=127.0.0.1:19092
B.bootstrap.servers=127.0.0.1:29092
A.consumer.isolation.level=read_committed
A->B.enabled=true
B->A.enabled=false
A->B.topics=orders
A->B.groups=orders-worker
A->B.replication.policy.class=org.apache.kafka.connect.mirror.DefaultReplicationPolicy
A->B.replication.factor=3
A->B.offset-syncs.topic.replication.factor=3
A->B.checkpoints.topic.replication.factor=3
A->B.heartbeats.topic.replication.factor=3
A->B.emit.offset-syncs.enabled=true
A->B.offset-syncs.topic.location=target
A->B.emit.checkpoints.enabled=true
A->B.emit.checkpoints.interval.seconds=10
A->B.sync.group.offsets.enabled=true
A->B.sync.group.offsets.interval.seconds=10
A->B.emit.heartbeats.enabled=true
A->B.sync.topic.configs.enabled=true
A->B.sync.topic.acls.enabled=false
```

这里 replication.factor=3、10 秒周期、target 位置与关闭 ACL 同步都是显式实验选择，不是默认值。新远端 topic 的副本因子默认是 2；内部 topic 常见默认因子为 3，单 broker 实验不能只改业务 topic 因子就认为全部内部状态可用。Worker 自身内部 topic 的副本、持久化与权限也需满足部署条件。

| 参数 | 4.1 基线 | 影响 |
| --- | --- | --- |
| `emit.offset-syncs.enabled` | true | 产生转换映射，关闭后不能再假定 checkpoint/组同步正常 |
| `offset-syncs.topic.location` | source | 映射写源还是目标；Source 与 Checkpoint 必须一致 |
| `emit.checkpoints.enabled` | true | 生成 checkpoint，不等于已写目标组进度 |
| `emit.checkpoints.interval.seconds` | 60 秒 | 生成周期，不是实际恢复点最大陈旧时间承诺 |
| `sync.group.offsets.enabled` | false | 显式开启才尝试更新空闲目标组 |
| `sync.group.offsets.interval.seconds` | 60 秒 | 组同步周期，还受状态、权限与任务健康影响 |
| `sync.topic.configs.enabled` | true | 同步允许范围的配置，不承诺所有属性完全克隆 |
| `sync.topic.acls.enabled` | true | 同步所支持的 topic ACL，不是全部身份、组/集群权限迁移 |

默认策略下，映射位于 source 时，A 中常见名为 `mm2-offset-syncs.B.internal`；本例改为 target 时，B 中对应为 `mm2-offset-syncs.A.internal`。位置变化还会影响名字中的另一端 alias，不能只把同名文件“搬过去”；先查询实际 topic 与策略。命名由[MirrorSourceConfig](https://github.com/apache/kafka/blob/4.1.0/connect/mirror/src/main/java/org/apache/kafka/connect/mirror/MirrorSourceConfig.java)和[MirrorCheckpointConfig](https://github.com/apache/kafka/blob/4.1.0/connect/mirror/src/main/java/org/apache/kafka/connect/mirror/MirrorCheckpointConfig.java)共同决定。

把映射放到目标可以减少源损毁后读取该映射的依赖，但不会复制尚未到达 B 的消息，也不会使 checkpoint 永远新鲜。配置/ACL 同步还需单独核对排除规则和目标权限，特别是镜像流是否允许应用写入。

### 5.2 对照源、目标实际状态

在已运行的隔离部署上做只读观察；有认证时为 Kafka 管理命令补充 `--command-config`：

```bash
bin/kafka-consumer-groups.sh --bootstrap-server 127.0.0.1:19092 --describe --group orders-worker
bin/kafka-consumer-groups.sh --bootstrap-server 127.0.0.1:29092 --describe --group orders-worker
bin/kafka-topics.sh --bootstrap-server 127.0.0.1:29092 --describe --topic A.orders
```

在前面的稀疏映射例子中，组输出的关键列可以整理为：

```text
CLUSTER GROUP          TOPIC     PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG
A       orders-worker  orders    0         105            110            5
B       orders-worker  A.orders  0         501            510            9
```

这是把两个集群的查询结果合并后的教学摘录，不是工具原生多出的 CLUSTER 列。数据段已复制并不妨碍两个组报告不同 lag：B 从保守起点多重读四条。若目标组尚无有效 committed，可能显示未定义位置或查不到该组，不能默认它已经继承 A。

通过已有 Connect REST 部署时，还应查询实际 connector 与全部 task 的状态；名称从 `/connectors` 返回值确认。专用 MM2 模式不应被假定天然暴露了同一个 8083 管理 API，不能把一个错误 REST 地址当成所有复制已停止。

### 5.3 用事件集合验收，不只看最大序号

持续写入带稳定事件 ID、业务 key、版本和时间的数据，保存收到成功响应的源事件集合；故障后与目标及业务结果逐条对账。源为 E100/E101/E102/E103、目标为 E100/E102/E103 时，两边最大序号都是 E103，仍缺 E101。

| 观察面 | 最少保留的证据 |
| --- | --- |
| 复制数据 | 每个分区的 task 状态、复制进度、事件缺口与重复 |
| 恢复位置 | 映射来源/年龄、checkpoint、源提交与目标实际提交 |
| 写入权威 | 旧写入口是否已围栏，新写 topic/路由与版本契约 |
| 目标可用性 | 副本/ISR、容量、配额、事务隔离和积压恢复能力 |
| 业务效果 | 幂等命中、金额/状态对账、外部副作用和端到端恢复时间 |

分别演练网络中断、Source task 停止、Checkpoint 停止、目标组意外提前启动、源突然损毁与回切。修改组位点、启动反向流或故障注入都是有副作用操作，只在隔离环境按已验证路径执行；管理命令见[Kafka 命令手册](./13-Kafka-Topic-Producer-Consumer与Group命令手册.md)。

## 6. 验收题 {/* #验收题 */}

### 6.1 为什么通常不把一个 Kafka quorum 直接跨高延迟 WAN？

答案：关键复制和控制协调会受到 WAN 延迟、抖动及分区故障影响。独立本地集群加跨集群复制能分开故障域，但交换来的是异步 RPO 与切换复杂度，不能再把它解释为同步零丢失。

### 6.2 数据复制追平，为什么目标组位置仍可能不对？

答案：数据、offset-sync、checkpoint 与目标组 committed 是不同状态。映射可能稀疏、checkpoint 陈旧、组同步没开启、目标组活跃或权限失败；必须核对目标实际恢复位置，而不只是数据 lag。

### 6.3 Active-Active 如何避免复制环路与冲突？

答案：默认策略用 alias 保留来源，结合来源识别和过滤避免把流无限绕回；自定义同名策略则需要额外验证。环路避免不等于冲突合并，还需定义 key 写入权威、业务版本和幂等规则。

### 6.4 Failback 为什么需要反向收敛？

答案：B 接管期间产生新历史，A 恢复不等于已拥有这些数据与业务结果。应先确定权威写入口、收敛差异、衔接 topic 与位点，再回切；直接改 bootstrap 可能遗漏新写或重复处理旧历史。

### 6.5 映射 100→500，源组提交 105，能直接设目标 505 吗？

答案：不能仅凭这一对映射外推。4.1.0 在本例只有该可用映射时保守转换为 501，可能重读，但避免越过未知区间。实际需使用适用映射和 checkpoint，不能自行假定源/目标位置始终线性对应。

### 6.6 emit.checkpoints=true 是否代表目标组会自动跟进？

答案：不代表。还需开启默认关闭的 sync.group.offsets，具备转换映射，并满足目标组无活跃成员等条件；已有目标位置还可能阻止回退。checkpoint 文件/消息存在不能替代实际组提交检查。

### 6.7 默认命名下，只改 bootstrap 到 B 就完成切换了吗？

答案：没有。源 orders 的镜像通常叫 A.orders，B 的 orders 是另一个本地流。需要明确旧历史与新写的衔接、消费起点、key 顺序和写入围栏，不能把两个 topic 当成天然连续日志。

### 6.8 开启 MM2 EOS 就能承诺整个灾备系统零丢失、零重复吗？

答案：不能。EOS 需要完整 Connect 配置，约束目标写入与源处理位置的协调，不让 A/B 成为跨集群同步提交，也不覆盖任意外部副作用或业务主动重复发布。灾难缺口、保守重放和应用幂等仍要独立验证。

## 7. 参考资料 {/* #参考资料 */}

- [Kafka 4.1 Geo-Replication](https://kafka.apache.org/41/operations/geo-replication-cross-cluster-data-mirroring/)
- [Kafka 4.1 MirrorMaker Configuration](https://kafka.apache.org/41/configuration/mirrormaker-configs/)
- [Kafka 4.1 Datacenters](https://kafka.apache.org/41/operations/datacenters/)
- [4.1.0 OffsetSyncStore](https://github.com/apache/kafka/blob/4.1.0/connect/mirror/src/main/java/org/apache/kafka/connect/mirror/OffsetSyncStore.java)
- [4.1.0 MirrorCheckpointTask](https://github.com/apache/kafka/blob/4.1.0/connect/mirror/src/main/java/org/apache/kafka/connect/mirror/MirrorCheckpointTask.java)
- [4.1.0 MirrorSourceConfig](https://github.com/apache/kafka/blob/4.1.0/connect/mirror/src/main/java/org/apache/kafka/connect/mirror/MirrorSourceConfig.java)
- [4.1.0 MirrorCheckpointConfig](https://github.com/apache/kafka/blob/4.1.0/connect/mirror/src/main/java/org/apache/kafka/connect/mirror/MirrorCheckpointConfig.java)
