---
title: "源码请求路径、积压、发送失败、主从异常与故障 Runbook"
sidebar_label: "14. 源码请求路径、积压、发送失败、主从异常与故障 Runbook"
sidebar_position: 14
description: "从客户端、Remoting/Proxy、Broker Processor 到 CommitLog 和复制定位 RocketMQ 故障。"
tags: [RocketMQ, 源码, Runbook]
---

# 源码请求路径、积压、发送失败、主从异常与故障 Runbook

源码阅读的目的不是背类名，而是把一个业务症状定位到“客户端、接入、路由、Broker 请求、存储、复制、派生索引、投递、业务处理”中的具体阶段。本文以 Apache RocketMQ 5.5.0 release 为基线；类名会演进，排障时必须固定实际运行 tag。

## 1. 先认识源码模块

| 模块 | 主要职责 | 常见排障入口 |
| --- | --- | --- |
| `client` / gRPC client | 路由、发送、消费、重试 | timeout、Rebalance、callback |
| `remoting` | Netty 协议、RequestCode、连接 | connect、request queue、response code |
| `namesrv` | Broker 注册与 Topic 路由 | no route、stale route |
| `broker` | Request Processor、消费/管理状态 | send/pull/pop/admin failure |
| `store` | CommitLog、ConsumeQueue、Index、flush/HA | disk、dispatch、recovery |
| `controller` | Broker 角色、epoch、SyncStateSet | no leader、failover、unclean |
| `proxy` | gRPC 接入、协议转换、路由 | endpoint、deadline、backend |
| `common` | 配置、协议对象、通用模型 | 配置实际默认值 |

先查运行二进制版本、镜像 digest 和 Git release tag。不要用 main 分支源码解释一个旧生产集群。

## 2. 高效源码阅读方法

从协议和证据反向追踪：

```text
error code / RequestCode
→ processor registration
→ processRequest
→ MessageStore call
→ put/get result enum
→ log/metric emitted at each branch
```

在源码仓库中可用：

```bash
git checkout <the-exact-release-tag>
rg "SEND_MESSAGE" broker remoting common
rg "class SendMessageProcessor" broker
rg "putMessage\(" broker store
rg "PutMessageStatus" store common
rg "SyncStateSet" controller broker
```

不要先从一个几千行类从头读到尾。先拿生产错误码、msgId、Topic/Group、Broker、Queue/offset 和时间窗构建搜索锚点。

## 3. 经典 Remoting 发送路径

```text
DefaultMQProducerImpl / client send API
→ topic route and MessageQueue selection
→ MQClientAPI / NettyRemotingClient
→ Broker NettyRemotingServer
→ SendMessageProcessor
→ MessageStore.putMessage
→ CommitLog append
→ flush / HA acknowledgement
→ Remoting response
```

类名以 5.5.0 实际 tag 为准。对一次 timeout，要判断请求停在哪一段：本地队列、网络连接、Broker Processor executor、CommitLog lock、flush 或 replica ACK。

## 4. 5.x gRPC/Proxy 路径

```text
gRPC SDK
→ Load Balancer
→ Proxy gRPC service / messaging processor
→ route/service manager
→ Broker Remoting request
→ Broker processor/store path
→ Proxy maps response to gRPC status/receipt
```

Proxy 增加了 endpoint、TLS/ACL、连接排空、gRPC Deadline、内部路由缓存与后端连接。客户端报 gRPC Deadline 时，Broker 可能已经写入；仍然是结果未知，需要 event_id 幂等。

用 Trace/结构化日志把 client request、Proxy request、Broker msgId 关联起来，避免三套日志无法对齐。

## 5. 存储与派生索引路径

```text
CommitLog append
→ local flush service
→ HA replication service
→ ReputMessageService scans committed data
→ dispatcher builds ConsumeQueue / IndexFile
→ Consumer reads logical offset and locates CommitLog
```

这解释了几个现象：

- Producer 成功后 Consumer 短时不可见：可能是 Reput/dispatch behind；
- Key 查不到但 msgId 可追：可能是 IndexFile/时间窗问题；
- Consumer lag 高而写入正常：可能是 ConsumeQueue 读取、Filter 或 Consumer；
- Broker 重启慢：可能在 CommitLog 恢复与派生结构追赶。

## 6. 消费请求路径

### 6.1 PushConsumer {/* #pushconsumer */}

```text
SDK pull/pop/receive loop
→ Broker Pull/Pop Processor
→ locate ConsumeQueue offset
→ read CommitLog and filter
→ client local process queue
→ listener / business transaction
→ success or retry state
```

### 6.2 SimpleConsumer {/* #simpleconsumer */}

```text
ReceiveMessage(invisibleDuration)
→ Broker marks Inflight
→ application processes
→ AckMessage
or invisible time expires → Ready/retry
```

Lag 排障要分别测 Broker 等待、客户端本地等待和 handler 时间。只看 listener P99 可能遗漏 SDK 缓存积压。

## 7. 选主路径

```text
Broker replica heartbeat/metadata
→ Controller evaluates SyncStateSet and master liveness
→ DLedger/Raft state machine commits decision
→ new master epoch/role
→ Broker registration to NameServer
→ Proxy/client route refresh
```

把 Controller leader、Broker master、NameServer route 和客户端 cached route 视为四份不同状态。切换故障常常发生在它们传播不一致，而不是“没有选出主”。

## 8. 统一取证清单

事故开始先记录 UTC/本地时区和影响窗口，保存：

```text
client SDK/version/config/endpoint/error code/deadline
event_id/key/msgId/topic/group/message type
queueId/queueOffset/commitLogOffset when available
clusterList/topicRoute/consumerProgress
Broker runtime/config/role/epoch/SyncStateSet
Controller leader/quorum/term/election logs
Proxy/LB endpoints/connections/backend errors
disk usage/await/throughput/network/GC/thread queues
deployments/config changes/cert rotations
```

高基数标识写日志与 Trace，不写 Prometheus label。先保护证据，再重启；无计划重启会清空本地队列、触发 Rebalance 并改变路由时间线。

## 9. Runbook：Producer 大量发送失败

### 9.1 先止血 {/* #先止血 */}

- 限制非关键 Producer 和 retry 并发；
- 保留 Outbox/待补偿事件，不丢弃；
- 若单 Broker/Proxy 故障且容量允许，灰度切流；
- 禁止所有应用以相同固定间隔无限重试。

### 9.2 再分层 {/* #再分层 */}

```text
1 local: serialization / local queue / in-flight / GC
2 endpoint: DNS / LB / TLS / ACL / Proxy
3 route: NameServer / Topic / Broker registration / cached route
4 broker processor: executor queue / reject / permissions / message type
5 store: disk watermarks / append lock / Page Cache / flush
6 HA: replica lag / SyncStateSet / ACK wait / Controller role
```

结果未知的 timeout 必须保留同一 event_id 重试。恢复后对账 receipt 与 Consumer 唯一事件，不能只看错误率回落。

## 10. Runbook：Consumer Lag 持续增长

1. 确认 Topic/Group 和最老消息年龄；
2. 比较生产率、成功消费率和 `net_drain_rate`；
3. 下钻每个 Queue，找热点/无 owner/阻塞 Group；
4. 检查 Consumer 在线、Rebalance、本地缓存、线程和 GC；
5. 检查 handler P99、数据库/API、锁与连接池；
6. 检查 retry/DLQ/Schema 错误是否激增；
7. 检查 Broker Get/磁盘读/dispatch behind；
8. 仅在 Queue 与下游有余量时扩 Consumer；
9. 必要时限流 Producer，保护磁盘保留窗口；
10. 预测追平时间并持续对账。

不要通过向前重置 offset 来“消除积压”；那是业务丢弃决策。

## 11. Runbook：Topic 无路由或路由陈旧

```text
Topic/Namespace spelling
→ query every NameServer
→ Broker clusterList and registration
→ topicRoute addresses/Queue distribution
→ client network reachability
→ Proxy route cache/backend
→ SDK route refresh logs
```

路由中返回容器内 IP、旧 Broker 地址或错误 advertise 地址时，NameServer 自身可达也无济于事。应从真实 Producer/Consumer 网络测试。

## 12. Runbook：Broker 磁盘满或 Page Cache Busy

### 12.1 保护 {/* #保护 */}

- 限流/停止非关键 Producer；
- 保护关键消费，避免 lag 继续超过保留窗口；
- 评估迁移/扩盘，保留事故证据。

### 12.2 禁止 {/* #禁止 */}

- 不手工删除当前 CommitLog、ConsumeQueue、Index、checkpoint；
- 不在未知副本状态下重建/格式化数据目录；
- 不把降低 `minInSyncReplicas` 当作无风险恢复；
- 不让日志与 CommitLog 继续争抢同一满盘。

### 12.3 诊断 {/* #诊断 */}

检查实际增长来源：正常消息、重试/DLQ、Half、Timer、日志、core dump 或副本重建临时空间；再对比保留策略、最老 Consumer lag 和 segment 清理条件。

## 13. Runbook：主从/Controller 异常

1. 确认 Controller 是否有 leader/多数派；
2. 确认副本组当前 Master、epoch 和 SyncStateSet；
3. 比较各副本 CommitLog offset、网络与磁盘；
4. 判断是 Controller 决策失败、Broker 角色未生效、注册未传播还是客户端旧路由；
5. 检查是否启用 Unclean election 及其业务风险；
6. 旧 Master 恢复时确保以正确角色/epoch 加入；
7. 切换后按已确认 event_id 验证 RPO，不只看 `clusterList`。

不要删除 Controller log 或 Broker epoch 文件来“强制重新选主”。这可能破坏 fencing 并扩大分叉。

## 14. Runbook：消息查不到或疑似丢失

用一条业务事件建立链：

```text
business event record
→ Producer attempt/receipt
→ Proxy/Broker log
→ msgId / CommitLog position
→ ConsumeQueue/Index
→ Consumer delivery/retry/DLQ
→ business idempotency record
```

分别判断：未产生、未发送、结果未知、已存储但未 dispatch、被 Filter、超出保留、已投递未完成、已进 DLQ或业务查询错误。Key 查询为空不能独立证明消息丢失。

## 15. 通过源码验证配置默认值

配置项可能在文档、配置类、示例文件和发行包中有不同默认。验证方法：

1. 在目标 tag 搜索字段定义和默认赋值；
2. 找配置怎样绑定到运行对象；
3. 找业务路径读取这个字段的位置；
4. 用运行时 `getBrokerConfig`/日志确认实际值；
5. 用最小实验验证行为，而不只相信输出。

例如调查 `minInSyncReplicas`，应继续追到 `putMessage` 返回状态与客户端映射，才能知道副本不足时业务看到什么错误。

## 16. 本地源码调试实验

在隔离环境：

1. 固定 5.5.0 源码 tag，构建与生产相同 JDK；
2. 为发送路径的 RequestCode、Queue、msgId、put status 加临时调试日志；
3. 对比正常、无路由、ACL 拒绝、磁盘保护和副本不足；
4. 使用 async-profiler/JFR 观察 CPU、锁、分配和 GC；
5. 用 `jstack`/线程 dump 判断 Processor、flush、HA、Reput 是否等待；
6. 将实验观察映射回已有 Metrics/日志，避免依赖定制二进制才能排障；
7. 删除调试改动，不把高频消息 body 或 Secret 写日志。

## 17. 事故关闭标准

恢复不能只写“重启后正常”。至少证明：

- SLO 恢复并持续观察一个约定窗口；
- Producer 最终失败/未知事件已补偿；
- Consumer lag 持续下降并给出追平时间；
- 已确认 event_id 无未解释缺口；
- 重复由幂等吸收，DLQ/Half/Timer 已治理；
- Replica/SyncStateSet/Controller 冗余恢复；
- 根因、促成因素、检测缺口和永久措施有 Owner/期限；
- Runbook、告警和容量模型已经更新。

## 18. 验收题

- 发送失败应沿哪几个 Processor/存储阶段？
- Lag 大但 Broker CPU 低可能在哪里？
- 为什么不能随意重置 offset“清积压”？
- 源码排障为何需要 msgId 和物理/逻辑 offset？
- gRPC Deadline 为什么不能证明 Broker 未写入？
- Controller 已选出 Master 后，客户端为什么仍可能失败？
- `getBrokerConfig` 显示一个值是否足以证明行为？
- 怎样用 event_id 关闭“疑似丢消息”的事故？

## 19. 参考资料

- [Apache RocketMQ 源码](https://github.com/apache/rocketmq)
- [RocketMQ 常见问题](https://rocketmq.apache.org/docs/bestPractice/06FAQ/)
- [RocketMQ Metrics](https://rocketmq.apache.org/docs/observability/01metrics/)
- [Controller 自动切换](https://rocketmq.apache.org/docs/deploymentOperations/03autofailover/)
