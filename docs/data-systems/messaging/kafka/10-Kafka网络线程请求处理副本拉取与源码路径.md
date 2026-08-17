---
title: "Network Thread、Request Handler、Replica Fetch 与源码路径"
sidebar_label: "10. Network Thread、Request Handler、Replica Fetch 与源码路径"
sidebar_position: 10
tags: [Kafka, 源码, Network Thread, Replica Fetch]
description: "从 SocketServer 到 KafkaApis、日志追加和副本拉取追踪 Kafka Broker 请求。"
---

# Network Thread、Request Handler、Replica Fetch 与源码路径

以固定 Kafka tag 阅读源码，核心路径：

```text
SocketServer acceptor/processor
→ parse request header/body
→ request channel
→ KafkaRequestHandler pool
→ KafkaApis handler
→ ReplicaManager / GroupCoordinator / Controller path
→ UnifiedLog / LogSegment
→ response queue → network processor
```

网络线程负责连接和协议，不应执行长存储逻辑；Request Handler 处理 API，受队列和线程池限制。RequestQueueTime、LocalTime、RemoteTime、ResponseQueueTime、ResponseSendTime 可帮助分段。

## Produce

Produce → 分区 leader → append validation/record batch → page cache/log → follower fetch → 根据 acks/min ISR 返回。磁盘写、复制等待和请求队列是不同阶段。

## Fetch

Consumer Fetch 可 long-poll 等待 min bytes；Replica Fetcher 从 leader 拉日志并推进 LEO/HW。副本落后查 fetch queue、网络、磁盘、单 partition 热点和 GC。

## 源码方法

用 API key 搜 handler，再沿 manager/log；通过单元测试和 protocol schema 确认版本。使用 JFR/async-profiler/perf 只在受控环境，关联 request metrics 和线程 dump。

## 验收题

- Network Processor 与 Request Handler 为什么分离？
- acks=all 的等待发生在哪条路径？
- Replica Fetch 与 Consumer Fetch 有何共同/不同？
- RequestQueueTime 高说明什么？

## 参考资料

- [Kafka source](https://github.com/apache/kafka)
- [Kafka protocol](https://kafka.apache.org/protocol)
