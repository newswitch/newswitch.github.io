---
title: "Raft Term、Log、Commit、Apply、Election 与 ReadIndex"
sidebar_label: "04. Raft Term、Log、Commit、Apply、Election 与 ReadIndex"
sidebar_position: 4
description: "从提案、日志复制、Commit、Apply 到线性读理解 etcd Raft。"
tags: [etcd, Raft, ReadIndex, Consensus]
---

# Raft Term、Log、Commit、Apply、Election 与 ReadIndex

> 版本基线：etcd 3.6；最后核验：2026-08-18。指标名称和 endpoint status 字段应以目标版本为准。

Raft 解决的不是“所有节点永远同时返回相同结果”，而是：在节点故障、消息延迟和重复传输存在时，只要仍有法定多数，就让复制状态机按同一顺序应用已经提交的操作。

理解这条路径后，才能正确判断 etcd 的高延迟究竟来自客户端、Leader、网络、WAL fsync、法定多数还是 Apply backlog。

## 1. 五个不能混用的位置

```text
client request
  → proposal
  → leader append/WAL
  → followers replicate
  → quorum acknowledge
  → commit index advances
  → state machine apply
  → MVCC/backend visible
  → client response
```

| 位置 | 表示什么 | 能否证明业务已可见 |
| --- | --- | --- |
| Proposed | Leader 接受了提案 | 不能 |
| Appended | 某成员日志里出现 Entry | 不能 |
| Replicated | Entry 到达部分 Follower | 不一定 |
| Committed | 法定多数确认，日志不会被后续合法 Leader 覆盖 | 尚需 Apply |
| Applied | Entry 已进入本地状态机 | 对该成员可见 |

因此不能看到单个成员 WAL 中存在某条记录，就宣布写入成功；也不能把 Follower 的 Apply 落后误判为日志尚未提交。

## 2. Term、角色与选举

Term 是单调递增的领导任期。成员通常处于 Follower、Candidate 或 Leader：

```text
Follower --选举超时--> Candidate --获得多数票--> Leader
    ^                         |
    └------收到有效 Leader 消息┘
```

Candidate 想获胜，不只是获得多数票，还要满足日志新旧约束，避免缺少已提交日志的节点成为 Leader 后覆盖安全状态。

Raft 的安全性不依赖机器时钟严格同步，但活性依赖超时和调度能正常前进。以下情况会引发不必要的选举：

- Leader CPU 长时间饥饿或 Stop-The-World；
- WAL fsync 尾延迟过高；
- 节点间网络 RTT、丢包或队列拥塞；
- 虚拟机暂停、宿主机争抢；
- 心跳间隔和选举超时相对网络条件设置过紧。

不要用“把 election timeout 调得很大”掩盖磁盘或网络故障。它会减少误选举，但也会延长真实 Leader 故障后的恢复时间。

## 3. 一次写请求经历什么

以一个 Put 为例：

1. 客户端连接任意健康成员；
2. 非 Leader 成员把需要共识的请求转交 Leader；
3. Leader 为操作生成 Proposal，并追加 Raft Entry；
4. Entry 进入 WAL 持久化路径，并发送给 Followers；
5. 法定多数确认后，Leader 推进 Commit Index；
6. 各成员按顺序 Apply 已提交 Entry；
7. MVCC 产生新的 Revision，Backend 状态更新；
8. 等待该请求 Apply 完成的服务端路径向客户端返回结果。

写延迟近似由路径中的慢项决定：

```text
client RTT
+ leader queue
+ leader WAL fsync
+ quorum peer RTT / follower persistence
+ apply queue and backend commit
+ response RTT
```

这是诊断模型，不是简单相加公式。WAL 批处理、并行复制和排队会让阶段相互重叠。

## 4. Commit Index 与 Applied Index

每个成员都维护自己已经知道的 Commit 位置和已经 Apply 的位置：

```text
commit index  = 12000
applied index = 11820
gap           = 180 entries
```

短暂差距属于正常流水线；差距持续扩大则说明状态机处理跟不上。常见原因包括：

- 大 Range/Txn 或大量 Watch 事件；
- Backend 提交延迟；
- CPU 被限额或长时间调度不到；
- 磁盘延迟导致后续处理堆积；
- Snapshot、Compaction、Defrag 与业务高峰重叠。

`etcdctl endpoint status --cluster -w table` 可以比较 Leader、Raft Term、Raft Index 和 Raft Applied Index。字段名称会随输出格式变化，自动化脚本应优先使用 JSON 并做版本校验。

## 5. 线性化读为什么也可能等

读请求不修改状态，但关键读需要回答：“我读到的结果是否至少包含在请求开始前已经成功的写？”

线性化读通常需要：

1. 找到当前 Leader；
2. 通过 ReadIndex 等机制确认 Leader 仍得到法定多数认可；
3. 等待本地状态机 Apply 到对应读位置；
4. 从 MVCC 读取一致视图。

ReadIndex 避免为每次读都追加一条普通业务日志，但不等于完全不经过共识确认。网络分区、Leader 抖动或 Apply 落后都会抬高线性读延迟。

串行化读可以从目标成员的本地已 Apply 状态返回，延迟更低，但可能陈旧。适用范围应按业务语义决定：

| 场景 | 建议 |
| --- | --- |
| 分布式锁归属、Leader Election、资源版本判断 | 线性化读 |
| 非关键监控面板、允许短暂陈旧的列表 | 可评估串行化读 |
| 写后立即确认 | 线性化读，并核对目标状态 |
| 只为降低延迟而切换读取模式 | 先证明陈旧读不会破坏不变量 |

## 6. 多数派、故障域与可用性

法定多数为 `floor(N/2)+1`：

| 成员数 | 多数派 | 可容忍同时故障 |
| ---: | ---: | ---: |
| 1 | 1 | 0 |
| 3 | 2 | 1 |
| 5 | 3 | 2 |

四节点仍需要三个多数派，只能容忍一个故障，通常不比三节点更可靠，却增加复制成本。成员应跨独立故障域部署，但成员间 RTT 又必须满足控制面延迟要求。

三节点集群失去两个成员时，剩余节点不能安全接受写。此时绝不能：

- 修改成员目录伪造新集群身份；
- 同时启动多个来自不同时间点的旧数据目录；
- 把一个旧快照节点直接当作“恢复的多数派”；
- 删除 WAL 或 Backend 文件尝试跳过错误。

优先恢复原法定多数；确实无法恢复时，按 Snapshot Restore 灾难恢复流程建立具有新集群身份的集群，并处理 Revision 回退对 Watch 客户端的影响。

## 7. 用指标给每一层找证据

至少关联以下类别，而不是只看 `endpoint health`：

| 层 | 典型证据 | 说明 |
| --- | --- | --- |
| Leader 稳定性 | Leader 变化次数、当前 Leader、Term | 频繁变化会放大尾延迟 |
| Proposal | pending、failed、committed、applied | 判断共识还是 Apply 堆积 |
| Peer 网络 | peer RTT、发送失败、丢包 | 决定法定多数确认速度 |
| WAL | fsync 延迟直方图 | 写路径关键尾延迟 |
| Backend | commit 延迟、DB size、quota | Apply 与存储压力 |
| 客户端 | gRPC code、deadline、重试次数 | 防止重试风暴掩盖根因 |

排查顺序：

```text
确认 Leader 是否稳定
→ 比较各成员 index/applied index
→ 看 proposal pending/failed
→ 对齐 peer RTT 与 WAL fsync P99
→ 检查 backend/CPU/磁盘
→ 最后核对客户端 deadline 与重试
```

## 8. 故障实验

只在独立三节点实验集群执行，并保留每个成员的 Snapshot。

### 8.1 实验一：停止一个 Follower {/* #实验一停止一个-follower */}

1. 持续写入小 Key，并记录成功率和 P99；
2. 停止一个 Follower；
3. 验证集群仍有多数派，读写继续；
4. 恢复节点，观察其 Raft Index 和 Applied Index 追平；
5. 记录追赶期间网络、磁盘和业务延迟。

### 8.2 实验二：停止 Leader {/* #实验二停止-leader */}

1. 用 `etcdctl endpoint status --cluster -w table` 确认 Leader；
2. 停止 Leader；
3. 记录第一次失败、无 Leader 窗口和新 Leader 产生时间；
4. 验证客户端是否正确轮询多个 Endpoint；
5. 恢复旧 Leader，确认它以 Follower 身份追平。

### 8.3 实验三：制造慢盘而不是直接断网 {/* #实验三制造慢盘而不是直接断网 */}

在可回滚的虚拟环境使用受控 I/O 限速或故障注入工具，让一个成员 WAL fsync 变慢。观察：

- 慢的是 Follower 时，多数派是否绕过它；
- 慢的是 Leader 时，写 P99 和选举是否恶化；
- Proposal pending 与 WAL fsync 是否同时上升；
- 故障撤销后 Apply gap 是否收敛。

不要在生产节点用 `kill -9`、`tc netem` 或磁盘限速命令做未经审批的实验。

## 9. 验收标准

完成本篇不能只会背“Raft 需要多数派”，还应能够：

- 画出 Proposal、Append、Commit、Apply、Response 的时间线；
- 从 endpoint status 判断 Leader 与 Apply 落后；
- 区分线性化读和串行化读的正确使用边界；
- 解释三节点为什么只能容忍一个成员故障；
- 用 peer RTT、WAL fsync、Proposal 和 Backend 指标定位慢层；
- 完成一次 Leader 故障实验并证明集群恢复收敛。

## 10. 参考资料 {/* #参考资料 */}

- [Raft paper](https://raft.github.io/raft.pdf)
- [etcd API guarantees](https://etcd.io/docs/v3.6/learning/api_guarantees/)
- [etcd performance](https://etcd.io/docs/v3.6/op-guide/performance/)
- [etcd failure modes](https://etcd.io/docs/v3.6/op-guide/failures/)
