---
title: "ZooKeeper 解决什么问题与一次读写的完整路径"
sidebar_label: "01. ZooKeeper 解决什么问题与读写路径"
sidebar_position: 1
description: "从客户端 Session 到本地读、Leader 写入、Zab 多数派提交与 Watch 通知，建立 ZooKeeper 协调请求的完整证据链。"
tags: [ZooKeeper, Coordination, Zab, Leader, Watch]
---

# ZooKeeper 解决什么问题与一次读写的完整路径

分布式系统最难的不只是保存数据，而是多个进程怎样就“谁是 Leader、谁仍然存活、配置是否变化、谁获得锁”达成一致。ZooKeeper 提供一组小而严格有序的原语，让应用不必自己实现复杂的协调协议。

## 1. ZooKeeper 适合保存什么

适合：

- 服务成员和在线状态；
- Leader/Owner 标识；
- 小型配置和版本；
- 分布式锁的竞争节点；
- 命名和路径映射；
- Barrier、队列等协调元数据。

不适合：

- 大文件和模型权重；
- 高频大对象写入；
- 业务关系表；
- 消息长期保留与消费进度；
- 日志、指标和时序数据；
- 把所有应用配置无限堆入单个 ZNode。

ZooKeeper 的数据树主要保存在内存，Transaction Log 和 Snapshot 用于持久化与恢复。ZNode 数据通常应保持很小。

## 2. Ensemble 与多数派

ZooKeeper 服务由多个 Server 组成 Ensemble：

```text
ZooKeeper Ensemble
├── Leader
├── Follower
├── Follower
└── Observer（可选，不参与投票）
```

常见使用奇数个投票节点：

| 投票节点 | 多数派 | 可容忍同时失去 |
| ---: | ---: | ---: |
| 3 | 2 | 1 |
| 5 | 3 | 2 |

四个投票节点仍需要三个形成多数派，只能容忍一个故障，因此通常不如三个节点经济。Observer 可以扩展读能力和跨地域观察，但不增加投票多数派容错。

## 3. 客户端连接与 Session

客户端配置多个 Server 地址，实际只连接其中一个：

```text
Client
→ TCP连接某个Server
→ 建立Session
→ 周期性心跳
→ 请求、响应和Watch事件复用连接
```

连接断开不等于 Session 立即过期。客户端可在 Session Timeout 内连接另一 Server，并继续使用原 Session。只有 Ensemble 判断 Session Expired 后，临时节点才会删除。

## 4. 一次读取的路径

普通读取通常由客户端当前连接的 Server 本地处理：

```text
Client getData(/service/a)
→ Connected Server
→ 本地内存DataTree
→ 返回data、version和stat
```

优点是读延迟低、可以横向分散。需要注意：ZooKeeper 提供其定义的一致性和顺序保证，但普通读并不是每次都经 Leader 做线性化读屏障。需要“先同步到最新视图再读”的场景要理解 `sync` 和应用协议边界。

## 5. 一次写入的路径

客户端可以连接 Leader 或 Follower。写请求最终由 Leader 排序：

```text
Client create/setData/delete
→ 当前连接Server
→ 转发Leader（若当前不是Leader）
→ Leader生成事务和zxid
→ 向Followers发送Proposal
→ 多数派持久化并ACK
→ Leader提交Commit
→ 各副本应用到DataTree
→ 返回客户端
→ 触发相关Watch事件
```

关键点：

- Leader 为写事务建立全局顺序；
- 需要投票成员多数派；
- 写入先进入事务日志，再应用到内存数据树；
- Watch 是变更通知，不携带完整新状态；
- Leader 故障后要重新选举和同步才能继续写。

## 6. 为什么 Server 存活不等于集群可写

`ruok` 返回 `imok` 只说明进程能够响应该命令，不保证它已经加入 Quorum，也不保证 Ensemble 拥有多数派。

故障例子：

```text
3节点Ensemble
→ 2个节点之间网络中断
→ 每个Java进程都可能仍存活
→ 只有拥有2个投票节点的一侧形成多数派
→ 孤立节点不能提交写
```

健康检查至少要判断：

- Server 角色和状态；
- 是否处于 Leader/Follower 正常服务状态；
- 是否拥有足够 synced followers；
- 延迟、outstanding request 和磁盘；
- 客户端是否能执行受控读写。

## 7. ZNode 变化怎样通知客户端

客户端可在读取或 exists 时注册 Watch：

```text
Client getData(/config, watch=true)
→ Server记录Watch
→ 其他Client setData(/config)
→ 事务提交
→ Server发送NodeDataChanged事件
→ Client重新读取数据
→ 按需要重新注册Watch
```

传统 Watch 通常是一次触发。事件只告诉“发生变化”，应用必须重新读取并处理注册 Watch 到重读之间的竞态。较新版本还支持持久或递归 Watch，但客户端和 Server 都需支持。

## 8. 临时节点怎样表示成员存活

服务实例创建 Ephemeral ZNode：

```text
/services/payment/instance-01
```

只要 Session 存活，节点存在；Session Expired 后，ZooKeeper 删除临时节点并触发 Watch。这适合成员关系，但必须理解：

- 短暂断网不立即删除；
- Session Timeout 过短会产生抖动；
- 进程暂停、Full GC 和网络问题可能导致 Session Expired；
- 原 Session 过期后，即使旧进程恢复也必须建立新 Session；
- 应用要防止旧 Leader 在外部系统继续写入，即 fencing 问题。

## 9. ZooKeeper 怎样实现 Leader 选举

应用 Leader 和 ZooKeeper Server Leader 是两个概念。

应用可创建 Ephemeral Sequential ZNode：

```text
/election/candidate-0000000012
/election/candidate-0000000013
/election/candidate-0000000014
```

编号最小者成为应用 Leader，其他候选只 Watch 自己前一个节点。这样避免所有客户端同时 Watch 最小节点造成惊群。

ZooKeeper Server 自己的 Leader 由 Zab 选举和 Epoch/zxid 等状态决定，不使用上述业务 Recipe。

## 10. ZooKeeper 在旧版 Kafka/Hadoop 生态中的作用

许多历史系统使用 ZooKeeper 保存：

- Broker/节点成员；
- Controller/Active Master 选举；
- Topic、Partition 或服务元数据；
- 配置和变更通知；
- 分布式锁与任务归属。

新 Kafka 可以使用 KRaft，但生产中仍可能维护旧 ZooKeeper 集群。迁移前必须核对产品版本和官方迁移流程，不能直接停止 ZooKeeper。

## 11. 一条故障怎样向上传导

```text
ZooKeeper磁盘fsync变慢
→ Proposal ACK变慢
→ 写延迟和Outstanding上升
→ 客户端请求超时/重连
→ Session可能过期
→ Ephemeral节点删除
→ 上层误判实例下线或重新选主
→ 业务抖动
```

这解释了为什么 ZooKeeper 的磁盘、JVM 停顿和网络延迟会影响整个分布式平台。

## 12. 最小观测项

- server state：leader/follower/observer；
- quorum size 和 synced followers；
- average/max latency；
- outstanding requests；
- packets received/sent；
- alive connections；
- watch count、ephemeral count、znode count；
- approximate data size；
- transaction log fsync；
- snapshot/log 磁盘容量；
- JVM heap、GC pause、线程和文件描述符；
- Session expiration 和客户端重连。

## 13. 课后实验

1. 连接三节点 Ensemble，观察客户端实际连接节点；
2. 从 Follower 发起写，确认仍由 Leader 提交；
3. 停止一个 Follower，验证读写继续；
4. 停止 Leader，记录重新选举时间；
5. 只保留一个投票节点，验证失去多数派；
6. 创建临时节点，分别测试短断线和 Session Expired；
7. 注册 Watch 并连续修改两次，观察一次性语义。

## 14. 参考资料

- [Apache ZooKeeper Overview](https://zookeeper.apache.org/doc/current/zookeeperOver.html)
- [ZooKeeper Administrator's Guide](https://zookeeper.apache.org/doc/current/zookeeperAdmin.html)
- [ZooKeeper Programmer's Guide](https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html)
