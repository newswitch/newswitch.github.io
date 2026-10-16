---
title: "CommitLog、ConsumeQueue、IndexFile 与刷盘"
sidebar_label: "04. CommitLog、ConsumeQueue、IndexFile 与刷盘"
sidebar_position: 4
description: "理解 RocketMQ 顺序消息存储、逻辑消费索引、Key 查询和刷盘恢复。"
tags: [RocketMQ, CommitLog, ConsumeQueue, IndexFile]
---

# CommitLog、ConsumeQueue、IndexFile 与刷盘

RocketMQ 的核心思想不是“每个 Topic 一个日志文件”，而是 Broker 将消息主体顺序追加到 CommitLog，再派生面向消费和检索的逻辑索引。这样把随机的多 Topic 写入收敛为更适合磁盘的顺序追加。

## 1. 三种结构分别保存什么

```text
Producer message
→ CommitLog: 完整消息记录 + 物理 offset
→ Reput/Dispatch
  ├─ ConsumeQueue: Topic + Queue 的逻辑 offset → CommitLog 位置
  └─ IndexFile: Key hash / time → 候选 CommitLog 位置
```

| 结构 | 保存内容 | 用途 | 是否权威消息主体 |
| --- | --- | --- | --- |
| CommitLog | body、Topic、Queue、属性、时间等完整记录 | 顺序写、恢复与复制 | 是 |
| ConsumeQueue | 物理位置、大小、Tag hash 等紧凑条目 | 按 Topic/Queue/逻辑 offset 消费 | 否，可由 CommitLog 派生 |
| IndexFile | Key/时间到物理位置的哈希索引 | 运维查询和追踪 | 否，不保证业务唯一 |

在经典默认实现中 ConsumeQueue 条目是固定长度紧凑结构，但源码演进、RocksDB 存储和 LiteTopic 等能力可能改变内部实现。理解“主体与派生索引”的边界比死记字节数更重要。

## 2. 一条消息写入经历的状态

```text
1 Broker 校验 Topic、权限、消息类型与大小
2 分配 Queue offset / 构造内部消息
3 CommitLog append 到 MappedFile
4 数据进入进程映射页与 OS Page Cache
5 按策略 flush 到稳定存储
6 按 HA 策略复制到其他 Broker replica
7 返回 SendStatus
8 Reput 服务扫描 CommitLog 并构建 ConsumeQueue/Index
```

这里至少存在三个不同的“成功”：

- append 成功：记录进入本机内存映射区域；
- flush 成功：本机达到配置要求的持久化点；
- replica ACK 成功：达到配置要求的副本确认数。

同步刷盘只约束本地持久化等待，副本同步由另一组 HA 参数决定。不能看到 `SYNC_FLUSH` 就推导出“节点故障也绝不丢”。

## 3. MappedFile、Page Cache 与顺序写

CommitLog 通常由固定大小的 MappedFile segment 组成。内存映射减少用户态复制并利用 Page Cache，但带来几个运维事实：

- Broker Heap 不高不代表内存没有压力，Page Cache 也是主要资源；
- 平均磁盘吞吐充足不代表 `fsync` P99 足够低；
- 同盘日志、容器层写放大或云盘突发额度耗尽会影响发送；
- segment 切换、预热、缺页和脏页回写可能制造尾延迟；
- 容器 memory limit 过紧可能把 Page Cache 与 JVM 一起挤压。

所以发送延迟高而 CPU 低时，要同时检查设备延迟、队列深度、吞吐、脏页、Page Cache busy 与 flush 统计。

## 4. ConsumeQueue 怎样驱动读取

Consumer 使用的是逻辑 Queue offset。Broker 大致执行：

```text
(topic, queueId, queueOffset)
→ read ConsumeQueue entry
→ obtain CommitLog physical offset + size
→ read message body from CommitLog
→ apply filter / return batch
```

消费延迟可能发生在两个地方：消息本身在 Queue 中等待，或者读取 CommitLog/过滤/网络变慢。只看 Consumer lag 数量无法区分。

若 CommitLog 已追加而 Reput/Dispatch 落后，Producer 可能已经成功，但 Consumer 暂时看不到新消息。此时要看 dispatch/reput behind，而不是误判消息丢失。

## 5. IndexFile 为什么不能做幂等数据库

IndexFile 使用哈希和链式槽定位候选消息。它适合按业务 Key 缩小排查范围，但存在：

- 哈希碰撞；
- 一个 Key 对应多条合法事件；
- 重试产生重复消息；
- 文件保留和重建边界；
- 查询结果仍需核对完整 Key、时间和 body。

因此 Key 查询是可观测能力，消费幂等必须在业务存储中实现。

## 6. 启动恢复与派生索引重建

正常/异常退出后，Broker 会检查 CommitLog 尾部记录是否合法，确定可恢复位置，再使 ConsumeQueue 等派生结构与有效 CommitLog 对齐。恢复时间受以下因素影响：

- 未正常关闭的尾部范围；
- CommitLog 和索引规模；
- 存储设备读取吞吐与延迟；
- 是否存在坏盘、截断或文件权限错误；
- Reput 需要追赶的物理 offset。

不要在未备份和未确认权威副本前手工删除 `commitlog`、`consumequeue`、`index`、checkpoint 或 abort 标记。即使某些逻辑索引可重建，错误操作也可能扩大数据窗口并破坏取证。

## 7. 清理不是“消费后删除”

RocketMQ 不是消费者 ACK 一条就立即物理删除一条。CommitLog segment 通常按保留时间和磁盘水位滚动清理。实际可回放时间取决于：

```text
configured retention
∩ available disk
∩ cleanup/watermark policy
∩ segment granularity
```

如果 Consumer lag 的最老消息已早于实际保留边界，扩容消费者也无法找回被清理的消息，只能从上游、备份或业务补偿恢复。

## 8. 容量不能只算 body

简化估算：

```text
daily_commitlog
  = msg_per_second × encoded_message_bytes × 86400

usable_days
  = usable_disk_bytes
    / (daily_commitlog + indexes + logs + retry/timer/transaction overhead)
```

编码后大小包含属性、Topic、Key、协议和存储头；重试、事务 Half、延时消息、DLQ 和复制还会增加空间。保留至少包括业务回放窗口、最长允许积压、事故处置时间和一个安全余量。

## 9. 观测证据

至少采集以下四组数据：

| 层 | 指标/证据 |
| --- | --- |
| 写入 | Put QPS、失败码、append/lock/flush P99 |
| 存储 | CommitLog max offset、磁盘水位、IOPS、吞吐、await |
| 派生 | Reput/dispatch behind、ConsumeQueue max offset |
| 读取 | Get QPS、读取失败、Page Cache miss/busy、Consumer lag age |

只读检查示例：

```bash
sh bin/mqadmin brokerStatus \
  -n nameserver-1:9876 \
  -b broker-a.example:10911

sh bin/mqadmin getBrokerRuntimeInfo \
  -n nameserver-1:9876 \
  -b broker-a.example:10911
```

不同 release 的命令名或输出字段会调整，先执行 `mqadmin help` 并保留原始输出。

## 10. 四类故障判断

### 10.1 Producer 成功但 Consumer 暂时不可见 {/* #producer-成功但-consumer-暂时不可见 */}

比较 CommitLog max offset、dispatch/reput offset 与 ConsumeQueue max offset。派生落后时优先处理存储/线程池问题，不要重发所有业务消息。

### 10.2 发送 P99 突然升高 {/* #发送-p99-突然升高 */}

按 Broker 请求队列 → CommitLog lock → Page Cache → flush → replica ACK 分解；同时检查 JVM Stop-the-World 和宿主机 I/O 干扰。

### 10.3 磁盘接近满 {/* #磁盘接近满 */}

先限流和停止非关键 Producer，确认保留策略与最老 lag，再扩容/迁移。不要直接删除当前 CommitLog 文件。

### 10.4 Key 查不到消息 {/* #key-查不到消息 */}

不能立即认定未写入。核对 Topic、时间窗、完整 Key、msgId、Broker 路由、IndexFile 状态，再沿 Producer receipt 和 CommitLog 证据确认。

## 11. 最小实验

1. 发送包含连续业务序号、Key、Tag 和属性的消息；
2. 记录 msgId、Queue offset 与 Broker；
3. 观察 CommitLog 与 ConsumeQueue 文件增长，但不修改文件；
4. 暂停 Consumer 制造 lag，证明消息仍按保留策略存储；
5. 在隔离环境比较同步/异步刷盘的吞吐与 P99；
6. 异常终止实验 Broker，重启后记录恢复、Reput 追赶和消息缺口；
7. 用连续序号而不是“能消费几条”判断 RPO。

## 12. 验收题

- ConsumeQueue 为何不保存完整 body？
- 同步刷盘在发送路径增加什么等待？
- IndexFile 为什么不能作为唯一约束？
- CommitLog 与逻辑索引不一致如何恢复？
- SEND_OK 能否证明所有副本已经 fsync，取决于什么？
- Broker Heap 不高时，Page Cache 为什么仍可能成为瓶颈？
- Consumer lag 超过物理保留窗口后为何无法仅靠重置 offset 恢复？

## 13. 参考资料

- [消息存储与清理](https://rocketmq.apache.org/docs/featureBehavior/11messagestorepolicy/)
- [Broker 基础最佳实践](https://rocketmq.apache.org/docs/bestPractice/01bestpractice/)
