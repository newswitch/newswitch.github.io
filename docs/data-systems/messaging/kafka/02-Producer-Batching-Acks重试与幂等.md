---
title: "Kafka Producer：Batching、Acks、重试与幂等生产"
sidebar_label: "02. Kafka Producer：Batching、Acks、重试与幂等生产"
sidebar_position: 2
description: "理解 Producer 从序列化、分区、批处理到确认、重试和幂等的完整发送路径。"
tags: [Kafka Producer, Acks, Batching, 幂等]
---

# Kafka Producer：Batching、Acks、重试与幂等生产

Producer 的目标是在吞吐、延迟、可靠性和内存之间平衡。业务线程调用 `send` 成功返回 future，不代表 broker 已持久确认；异步错误必须被回调、指标或 future 捕获。

## 1. 发送路径

```mermaid
flowchart LR
  A["业务记录"] --> B["Serializer"] --> C["Partitioner"]
  C --> D["Record Accumulator"] --> E["Sender Batch"]
  E --> F["Leader Broker"] --> G["Replica ACK"]
```

Serializer 决定字节和 schema；Partitioner 根据显式 partition、key 或策略选择分区；Accumulator 按 partition 聚合 batch；I/O 线程发送并处理 ACK/重试。

## 2. Key 与分区

相同业务 key 通常映射到同 partition，从而获得该 key 的日志顺序。Key 改变、partition 数增加、partitioner 版本变化都可能改变映射。无 key 的粘性批策略可提高 batching，但不能提供业务 key 顺序。

## 3. Batching 与压缩

更大 batch 和适度等待能提高压缩比、减少请求与系统调用，但增加排队延迟和 Producer 内存。判断参数不能只看 batch 上限，要看实际 batch-size 分布、records/request、compression ratio 和 buffer pool wait。

压缩由 Producer 对 batch 执行，broker 通常存储压缩 batch。选择 codec 应比较 CPU、网络、磁盘和端到端延迟。

## 4. Acks 与副本

Acks 控制 leader 在什么条件下响应。最强确认通常要求满足 ISR 协议的副本确认，并配合最小同步副本设置；可靠性还取决于副本数、ISR、unclean leader election 等配置。参数名、默认值与约束必须按当前官方文档核对。

强 ACK 无法防止业务把错误数据成功写入，也不能替代异地灾备。

## 5. 重试与顺序

网络超时时 Producer 不知道请求是否已成功。重试可避免丢失，但传统模式可能重复；多个并发未确认请求还可能影响失败重试后的顺序。幂等 Producer 通过 producer identity、partition sequence 等机制让 broker 识别重试重复，并维护顺序约束。

幂等范围是单 Producer 会话向 Kafka partition 的写入，不等于业务端到端去重。进程重启、上游重复产生、跨系统副作用仍需要稳定 event ID。

## 6. 超时体系

区分：元数据等待、batch 等待、请求超时、总投递时限和阻塞获取 buffer。总投递时限必须覆盖合理重试，却不能长到业务误认为成功。同步 `.get()` 会把异步 pipeline 变成逐条等待，吞吐骤降。

## 7. 安全代码原则

- 序列化失败和超大消息立即失败；
- 回调记录 topic/partition/error 类别，不泄露 payload；
- 只有可重试错误自动重试，认证/授权/schema 错误快速失败；
- 关闭时 flush 并设置有界超时；
- 用 event ID 在下游校验，不能依赖 Kafka offset 作为跨 topic 唯一键。

## 8. 指标与实验

观察 send rate、request latency、record error/retry、batch size、compression ratio、buffer available/wait、metadata age。分别改变 batch/等待、acks 和压缩，固定输入记录与并发，比较吞吐、P99、CPU、网络和重复校验。

注入 broker 重启或短时断网，验证回调错误、重试、顺序和 event ID 唯一性。只在隔离环境进行。

## 9. 掌握验收

- 画出 serializer、partitioner、accumulator、sender 和 broker；
- 解释 batching 为什么提高吞吐又增加排队延迟；
- 说明 ACK、副本和最小 ISR 如何共同决定故障窗口；
- 区分 Kafka 幂等生产与业务幂等；
- 用指标定位 buffer 等待、请求慢或序列化错误。

上一篇：[Kafka 架构与分区日志](./01-Kafka架构分区日志Segment与索引.md)　下一篇：[Consumer Group、Offset、Rebalance 与顺序](./03-Consumer-Group-Offset-Rebalance与顺序.md)

## 10. 参考资料 {/* #参考资料 */}

- [Kafka Producer Configuration](https://kafka.apache.org/documentation/#producerconfigs)
