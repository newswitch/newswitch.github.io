---
title: "NameServer、Broker、Proxy、Controller 架构"
sidebar_label: "03. NameServer、Broker、Proxy、Controller 架构"
sidebar_position: 3
description: "区分 RocketMQ 路由、存储、接入与选主组件并追踪配置传播。"
tags: [RocketMQ, NameServer, Broker, Proxy, Controller]
---

# NameServer、Broker、Proxy、Controller 架构

RocketMQ 5.x 同时保留经典 Remoting 链路并引入 Proxy/gRPC 与 Controller。四个组件分别承担路由、数据、接入和选主职责。把它们混成“RocketMQ 节点”，会让故障判断完全失去方向。

## 1. 两种常见请求入口

```text
经典 4.x Remoting 客户端
Client ──查路由──> NameServer
Client ──收发消息────────────> Broker

5.x gRPC 客户端
Client ──gRPC──> Load Balancer ──> Proxy
                                      ├─查路由──> NameServer
                                      └─收发────> Broker

Controller ──管理 Broker replica group 的角色/epoch/SyncStateSet
```

Controller 不在每条业务消息的数据路径上；NameServer 不复制 CommitLog；Proxy 通常不成为消息的长期权威存储。Broker 才保存消息和主要消费状态。

## 2. 组件职责与持久状态

| 组件 | 职责 | 是否保存消息 |
| --- | --- | --- |
| NameServer | Broker 注册、Topic 路由发现 | 否；各节点不做业务消息复制 |
| Broker | 校验、存储、复制、投递、消费进度 | 是；CommitLog 是核心数据 |
| Proxy | gRPC 接入、协议转换、路由与连接治理 | 通常不保存长期业务消息 |
| Controller | Broker 副本组选主、epoch、SyncStateSet | 不保存消息，但自身共识日志是关键状态 |

NameServer“轻量/无共享”不等于只部署一台。多节点解决路由发现可用性；它不能代替 Broker 副本。

## 3. 路由怎样传播

```text
Broker 启动/心跳
→ 向每个 NameServer 注册 Broker、Topic、Queue 和地址
→ Producer/Consumer 或 Proxy 查询 TopicRouteData
→ 客户端缓存并周期刷新
→ 选择 MessageQueue 和 Broker 地址
```

因此路由存在多个版本：Broker 当前配置、NameServer 看到的注册、Proxy 缓存、客户端缓存。故障排查必须逐层比对，而不是只执行一次 `topicList`。

常用只读证据：

```bash
sh bin/mqadmin clusterList -n nameserver-1:9876
sh bin/mqadmin topicRoute -n nameserver-1:9876 -t order-events
sh bin/mqadmin getBrokerConfig \
  -n nameserver-1:9876 \
  -b broker-a.example:10911
```

执行前用同版本 `mqadmin help <command>` 核对参数。还要从客户端所在网段测试路由里返回的 Broker/Proxy 地址，控制节点上可达并不能证明业务 Pod 可达。

## 4. Broker 内部并非一个线程

Broker 收到请求后，会按 RequestCode 分发到不同 Processor 和线程池，再进入消息存储、HA 或消费状态处理：

```text
Remoting request
→ NettyRemotingServer
→ request processor / executor
→ SendMessageProcessor / PullMessageProcessor / ...
→ MessageStore
→ CommitLog / ConsumeQueue / HA
```

因此“Broker 进程正常”仍可能出现某个线程池排队、Page Cache busy、磁盘刷盘长尾、逻辑索引落后或副本确认阻塞。监控要覆盖请求队列和存储路径，而不是只有 JVM 存活。

## 5. Proxy 的 local 与 cluster 形态

### 5.1 Local mode {/* #local-mode */}

Proxy 与 Broker 同进程或同节点，部署简单、少一次跨节点跳转，适合实验和较小拓扑。但 Proxy 连接压力会与 Broker JVM/CPU/故障域耦合。

### 5.2 Cluster mode {/* #cluster-mode */}

独立 Proxy 经负载均衡水平扩展：

```text
gRPC Clients → L4/L7 LB → Proxy replicas → Brokers
```

这样可独立扩展长连接和接入 QPS，也能隔离 Broker，但必须处理：

- LB 是否支持所需 gRPC/长连接行为；
- TLS、ACL 和客户端真实来源；
- Proxy 到 NameServer、Broker 的双向可达；
- 发布时连接排空与优雅停机；
- 端到端 Deadline，避免每层独立超时相加；
- Proxy 缓存与 NameServer 路由变化传播。

## 6. Controller 管理的不是消息副本内容

Controller 对 Broker replica group 维护主角色、epoch 和 SyncStateSet。若 Controller 自身需要容错，应以 3 个或更多节点形成 Raft 多数派。Controller 可独立部署，也可嵌入 NameServer，但两个逻辑职责仍不同。

```text
Controller quorum
  → 判断当前 Master 是否可用
  → 从合格副本中选新 Master
  → 分配更高 epoch / 通知角色变化
  → Broker 注册新路由
  → Client/Proxy 刷新后发送到新 Master
```

单 Controller 故障主要损害“切换能力”，已有 Master 的正常收发不一定立刻中断。反过来，Controller 多数派正常也不能保证 Broker 数据已同步；还要看 SyncStateSet 和复制 offset。

`enableElectUncleanMaster=true` 允许从 SyncStateSet 外选择可能落后的副本，可能用数据丢失换可用性。它是业务 RPO 决策，不是普通运维开关。

## 7. 一次主故障为什么不会瞬时透明

主故障后的恢复总时间近似：

```text
failure detection
+ Controller election/decision
+ Broker role transition
+ Broker registration to NameServer
+ Proxy/client route refresh
+ connection retry
```

若应用 Deadline 小于这条链路，自动切换成功期间仍会看到超时。客户端重试又可能产生重复消息，因此 HA 验收要同时记录 RTO、发送不确定结果、重复和缺口。

## 8. 故障矩阵

| 故障 | 可能仍可用 | 主要受影响 | 首要证据 |
| --- | --- | --- | --- |
| 单 NameServer | 已缓存旧路由 | 新路由/变更发现 | Broker 注册、各 NS route 差异 |
| 全部 NameServer | 缓存期内已有路由 | 新客户端、故障切换传播 | 客户端 route 日志 |
| 单 Proxy | 其他 Proxy | 该连接上的请求 | LB endpoint、连接错误 |
| Controller follower | 多数派仍在 | 通常无明显业务影响 | quorum、leader、复制 |
| Controller 无多数派 | 当前 Master 可能继续服务 | 自动选主/元数据变更 | Controller 日志与 term |
| Broker Master | 合格副本可切换 | 短时发送/消费、重复 | epoch、SyncStateSet、route |
| Broker 磁盘慢 | 进程可能存活 | 发送 P99、复制和积压 | flush、I/O、Page Cache |

## 9. 配置传播排障顺序

以“创建了 Topic 但客户端仍提示无路由”为例：

1. 确认命令操作的是正确集群和 NameServer；
2. 在每个 NameServer 查询 `topicRoute`，比较结果；
3. 检查目标 Broker 是否注册、Topic Queue 是否分配；
4. 检查路由中 advertise 地址能否从客户端访问；
5. 若走 Proxy，检查 Proxy endpoint、缓存与后端连接；
6. 检查客户端 SDK 版本、Namespace/Topic 名称和缓存刷新；
7. 最后再考虑重启；无证据重启会抹掉传播时间线。

## 10. 最小架构实验

建立 2 个 NameServer、2 个 Proxy、一个带副本的 Broker group 与 3 个 Controller：

1. 从两个 NameServer 分别导出路由并校验一致；
2. 停一个 NameServer，验证已有与新客户端行为；
3. 滚动一个 Proxy，验证连接排空和错误率；
4. 停 Controller follower，再破坏多数派，比较已有收发与切换能力；
5. 持续发送连续业务序号后停止 Master；
6. 记录检测、选主、注册、客户端恢复各阶段耗时；
7. 比对所有收到 SEND_OK 的消息是否有缺口或重复。

## 11. 验收题

- NameServer 为什么不是消息副本？
- Proxy 与 Broker local/cluster mode 有何差异？
- Controller 故障是否必然中断已有收发？
- 路由缓存为何能提高可用却导致陈旧？
- Controller 多数派与 Broker SyncStateSet 分别证明什么？
- 为什么主从切换成功仍可能超过应用 Deadline？
- Topic 路由从 Broker 到业务客户端经过哪些缓存？

## 12. 参考资料

- [RocketMQ 架构术语](https://rocketmq.apache.org/docs/introduction/03terms/)
- [RocketMQ 部署](https://rocketmq.apache.org/docs/deploymentOperations/01deploy/)
- [Broker 自动主从切换](https://rocketmq.apache.org/docs/deploymentOperations/03autofailover/)
