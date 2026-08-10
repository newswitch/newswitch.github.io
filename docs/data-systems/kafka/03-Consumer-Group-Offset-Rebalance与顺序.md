---
title: Kafka Consumer Group、Offset、Rebalance 与顺序边界
sidebar_position: 3
tags: [Kafka Consumer, Consumer Group, Offset, Rebalance]
description: 理解消费者拉取、分区分配、offset 提交、重平衡和消息积压的正确性与性能边界。
---

# Kafka Consumer Group、Offset、Rebalance 与顺序边界

Consumer Group 让多个实例分担 partition。同一 group 中一个 partition 在稳定分配时由一个 consumer 成员处理；consumer 数超过 partition 数，多出的成员不会获得数据。

## 1. 拉取与分配

Consumer 获取集群元数据、加入 group、协商 partition assignment，再按 offset 发起 fetch。Group coordinator 管理成员、generation/epoch 和已提交 offset。组外不同 consumer group 各自读取完整日志。

## 2. Offset 的三种位置

- **log end offset**：partition 当前末尾；
- **consumer position**：当前实例下一条准备读取的位置；
- **committed offset**：故障重分配后 group 恢复的位置。

```text
lag ≈ log_end_offset - committed_or_current_position
```

记录数 lag 不能直接代表时间延迟；低流量 partition 100 条可能很旧，高流量 partition 10 万条可能只落后几秒。应同时记录事件时间/append 时间 lag。

## 3. 提交与处理语义

先提交后处理可能丢；先处理后提交可能重复。生产常选择 At-Least-Once，加幂等 sink 或事务协调。自动提交简单但容易与实际业务处理完成时机脱节；手工同步/异步提交也要处理重试、generation 变化和乱序回调。

不要在处理尚未完成时提交更大 offset。并发处理同 partition 时，需要追踪连续完成水位，不能以“最快任务完成的 offset”覆盖中间未完成记录。

## 4. Rebalance

成员加入/退出、订阅或 partition 变化、心跳/处理超时都可能触发重新分配。期间消费可能暂停，未提交记录会重放。协作式分配和静态成员身份可减少不必要迁移，但不能消除故障恢复。

慢处理要区分：poll 线程是否被业务阻塞、处理时限是否合理、心跳机制与客户端版本行为。常见模式是 poll 与 worker 解耦，并用 pause/resume 控制在途记录和背压。

## 5. 顺序边界

Kafka 只保证 partition 日志顺序。要让同订单有序：producer 使用稳定 key；consumer 不跨 partition 假定全局顺序；若同 partition 内并发处理，要按 key 串行或在提交/输出处恢复顺序。

即使日志有序，CDC 多表事务、迟到网络事件和业务版本也可能造成语义乱序，应使用 source version/position 防旧状态覆盖新状态。

## 6. Backpressure 与积压

Consumer 可 pause partition，在下游恢复后 resume；也可限制 fetch 和在途任务。无限制拉取会堆积内存，完全停止 poll 又可能离组。设计有界队列、高低水位和明确丢弃/失败策略。

积压恢复时间估算：

```text
catch_up_time = backlog / (consume_rate - produce_rate)
```

只有消费能力大于持续生产，lag 才会下降。

## 7. 指标与排障

- records/bytes consumed、fetch latency/throttle；
- records lag max 与时间 lag；
- assigned partition、rebalance rate/duration；
- poll idle、处理队列、失败/重试/DLQ；
- commit latency/failure；
- 各 partition lag 分布而非 group 总和。

## 8. 实验

用 4 partition topic 依次启动 1、2、4、6 个同 group consumer，记录分配与吞吐。处理后、提交前杀进程，观察重复；处理前提交再杀进程，观察丢失风险。用 event ID 和业务汇总验证，不只看日志。

## 9. 掌握验收

- 区分 position、committed offset 与 log end；
- 解释 consumer 多于 partition 为什么不加速；
- 设计并发处理下的连续提交水位；
- 说明 rebalance 的触发、暂停和重放；
- 计算积压是否能在目标时间追平。

上一篇：[Producer Batching、Acks 与幂等](./02-Producer-Batching-Acks重试与幂等.md)　下一篇：[副本、ISR、Leader 选举与 KRaft](./04-副本ISR-Leader选举与KRaft.md)

## 参考资料

- [Kafka Consumer Configuration](https://kafka.apache.org/documentation/#consumerconfigs)
