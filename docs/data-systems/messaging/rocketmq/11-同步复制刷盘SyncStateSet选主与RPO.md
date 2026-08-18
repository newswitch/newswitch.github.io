---
title: "同步复制、刷盘、SyncStateSet、选主与数据丢失边界"
sidebar_label: "11. 同步复制、刷盘、SyncStateSet、选主与数据丢失边界"
sidebar_position: 11
description: "拆解 Broker 写确认、磁盘刷盘、复制确认、Controller 选主和数据丢失窗口。"
tags: [RocketMQ, Replication, SyncStateSet, RPO]
---

# 同步复制、刷盘、SyncStateSet、选主与数据丢失边界

RocketMQ 高可用至少包含三个独立问题：本机是否持久化、消息是否复制到其他副本、故障后谁有资格成为新 Master。只看到“主从 + Controller”不能推出 RPO=0。

## 1. 先分开四个时间点

```text
T1 master append memory/page cache
T2 local fsync
T3 replicas receive/append
T4 required replicas acknowledge according to policy
T5 producer receives SEND_OK

later:
T6 Controller detects master failure
T7 eligible replica is elected with a higher epoch
T8 route propagates and clients resume
```

T1–T5 决定写入确认和 RPO，T6–T8 决定 RTO。同步刷盘约束本地 T2；副本确认约束 T3/T4；Controller 解决 T6/T7。它们不能互相替代。

## 2. 本地刷盘与副本复制是两条轴

| 本地 | 副本 | Master 主机故障 | 整机/磁盘同时故障 |
| --- | --- | --- | --- |
| 异步刷盘 | 异步复制 | 可能丢 Page Cache 与未复制尾部 | 风险最大 |
| 同步刷盘 | 异步复制 | 本机盘有数据但切到落后副本仍可能丢 | 原主盘不可用时仍有窗口 |
| 异步刷盘 | 同步副本 ACK | 多副本已有记录，但是否稳定落盘取决于实现/策略 | 需验证副本持久化点 |
| 同步刷盘 | 同步副本 ACK | 确认路径最强，延迟和可用性成本最高 | 仍需多数故障域与演练 |

`SYNC_FLUSH` 不等于同步复制；`allAckInSyncStateSet` 也不能替代对副本落盘语义和故障域的验证。

## 3. SyncStateSet 是动态合格集合

SyncStateSet 表示当前与 Master 同步程度满足要求、可参与强确认/选主判断的副本集合。它不是静态配置列表：落后超过条件的副本可能被移出，追平后再加入。

相关配置需要组合理解：

| 配置 | 作用 | 代价/风险 |
| --- | --- | --- |
| `allAckInSyncStateSet` | 等待集合内所有副本 ACK | 任一慢副本拉高 P99/降低可用性 |
| `inSyncReplicas` | 指定所需同步副本数量 | 数值越高，写确认越严格 |
| `minInSyncReplicas` | 集合不足时拒绝写 | 保护 RPO，但故障时可能停止生产 |
| `haMaxTimeSlaveNotCatchup` | 判断副本落后的时间条件 | 过短导致集合抖动，过长保留慢副本 |
| `enableElectUncleanMaster` | 是否允许集合外副本当选 | 开启可能丢失已确认消息 |

具体默认值和配置交互必须以目标 5.5.0 release 为准。配置文件里存在参数并不证明生效，还要通过运行时状态和故障实验确认。

## 4. 为什么“所有副本 ACK”可能放大延迟

假设 SyncStateSet 有 3 个副本：

```text
replica A ACK = 2 ms
replica B ACK = 3 ms
replica C ACK = 80 ms
```

等待所有副本时，写 P99 被 C 主导。若 C 间歇落后并频繁进出集合，还会出现延迟和可写性抖动。排障不能只看 Master 磁盘，要逐副本看 offset、网络 RTT、磁盘 await 和 GC。

## 5. Controller 与 epoch 防止双主写

Controller 使用多数派维护副本组的主身份与 epoch。正常切换大致为：

```text
detect old master unavailable
→ choose eligible replica from SyncStateSet
→ allocate higher master epoch
→ notify Broker role change
→ new master registers route
→ old master returns as replica/learner and catches up
```

旧 Master 恢复后不能凭旧配置继续对外写。Broker 的 epoch 文件和 Controller 日志都是防止角色回退的重要状态，不能随意删除。

Controller 单点故障通常影响新的切换能力，不必然中断已有 Master；Controller 失去多数派时，也不能用重启所有 Broker 代替共识恢复。

## 6. Clean 与 Unclean Election

### 6.1 Clean election {/* #clean-election */}

只从 SyncStateSet 选择合格副本。优点是保护已确认数据，缺点是在没有合格副本时保持不可用。

### 6.2 Unclean election {/* #unclean-election */}

允许落后副本成为 Master。优点是可能更快恢复服务，缺点是新 Master 缺少的尾部消息可能永久丢失，旧 Master 恢复后还要处理分叉。

是否允许 Unclean 由业务决定：

| 业务 | 倾向 |
| --- | --- |
| 支付、订单状态、关键任务 | 宁可短时不可用，避免消息缺口 |
| 可从源系统重建的遥测/缓存事件 | 可能接受有限 RPO 换可用性 |

必须写入灾备预案，不能事故中临时修改开关而没有 event_id 对账方案。

## 7. Producer Receipt 如何解释

收到 SEND_OK 只表示满足当前 Broker 配置的成功条件。要向业务承诺 RPO，需要一条证据链：

```text
receipt success definition
+ local flush policy
+ replica ACK policy
+ SyncStateSet at that moment
+ failure domains of replicas
+ election policy
+ continuous-sequence fault test
```

若三个副本都在同一宿主机、同一云盘故障域或同一机架，同步复制也不能抵御共同故障。

## 8. RPO/RTO 验收实验

持续发送稳定 `event_id` 和连续序号，并分别记录“业务产生、Producer receipt、Consumer 唯一处理”。按一次只改变一个变量进行：

1. 停一个非 Master replica；
2. 让一个 replica 磁盘变慢，观察 SyncStateSet 和 P99；
3. 在有合格副本时停止 Master；
4. 失去 Controller follower，再失去多数派；
5. 隔离 Master 网络但保留进程，验证无双主；
6. 仅在隔离测试环境验证没有 clean candidate 的行为；
7. 新 Master 恢复后比对所有 SEND_OK 序号、重复和缺口。

输出至少包括：

```text
RPO = number/range of acknowledged event_ids missing after recovery
RTO = first failed request → sustained successful requests after route convergence
duplicate rate = total delivered - unique event_ids
```

只看 Broker 角色已经变成 Master，不算通过。

## 9. 复制异常 Runbook

### 9.1 SyncStateSet 缩小 {/* #syncstateset-缩小 */}

1. 记录缩小时间、成员和当时写入延迟；
2. 对比各副本 CommitLog offset 与落后时间；
3. 检查 Master↔Replica 网络 RTT/丢包/带宽；
4. 检查慢副本磁盘 await、吞吐额度、Page Cache 和 GC；
5. 检查是否正在恢复大量历史数据；
6. 评估 `minInSyncReplicas` 是否即将触发拒写；
7. 不为恢复可写性直接降低保护参数，先让业务降流量。

### 9.2 主切换后出现发送超时 {/* #主切换后出现发送超时 */}

分解检测、选主、角色通知、NameServer 注册、Proxy/客户端路由刷新和连接重建各段。切换已经完成但客户端仍用旧路由，是控制面传播问题，不一定是复制失败。

### 9.3 新 Master 怀疑缺消息 {/* #新-master-怀疑缺消息 */}

冻结破坏性操作，保存旧/新副本数据目录、epoch、Controller 状态和 Producer receipt。按 event_id/offset 做缺口清单，再决定从源业务、旧副本或补偿 Topic 恢复。不要让旧 Master 直接以 Master 身份重新上线。

## 10. 告警设计

| 告警 | 意义 |
| --- | --- |
| SyncStateSet 小于期望 | 冗余/RPO 降级 |
| replica lag 时间/字节增长 | 副本可能被移出集合 |
| `minInSyncReplicas` 拒写 | 数据保护正在牺牲可用性 |
| Controller 无 leader/无多数派 | 自动切换能力丢失 |
| master epoch 异常变化 | 频繁选主或角色抖动 |
| send P99 与 replica ACK 同升 | 慢副本拖累确认 |
| Unclean election 开启 | 持续风险配置告警 |

## 11. 验收题

- 本地同步刷盘与副本同步有何差异？
- SyncStateSet 缩小时为何可能拒绝写？
- Unclean election 换取了什么、牺牲什么？
- 如何证明已确认消息的 RPO？
- Controller quorum 与 Broker replica quorum 分别解决什么？
- 为什么所有副本 ACK 会被最慢副本拖累？
- 主从切换 RTO 包含哪些传播阶段？
- 同机三个副本为什么仍不能满足故障域要求？

## 12. 参考资料

- [Controller 自动故障切换](https://rocketmq.apache.org/docs/deploymentOperations/03autofailover/)
- [Broker 基础最佳实践](https://rocketmq.apache.org/docs/bestPractice/01bestpractice/)
