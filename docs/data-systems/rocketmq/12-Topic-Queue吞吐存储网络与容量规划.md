---
title: "Topic/Queue、吞吐、存储、网络与容量规划"
sidebar_position: 12
tags: [RocketMQ, 容量规划, Queue, Storage]
description: "按消息速率、大小、保留、副本、积压和恢复估算 RocketMQ Broker。"
---

# Topic/Queue、吞吐、存储、网络与容量规划

## 基础量

```text
ingress bytes/s = messages/s × average encoded bytes
disk ≈ ingress × retention × replica copies
     + ConsumeQueue/Index/log/temp + safety headroom
network ≈ producer ingress + replication + consumer egress + recovery
```

使用 P95/P99 消息大小和压缩后真实写入，不只平均值。重复、重试、事务/延迟消息和积压都增加保留。

## Queue

Queue 数 ≥ 所需并行消费度，但过多增加路由、文件、调度和 rebalance。按 Broker 均衡分布，检查 sharding key 是否倾斜。单热 Queue 会让平均 Broker 利用率看似正常。

## Broker

同时满足 CPU/GC、Page Cache、磁盘顺序写/刷盘、网络、文件描述符和一个节点故障后的复制/消费。预留磁盘水位与恢复带宽，不能在 90% 满才扩容。

## 压测

固定 Topic/Queue、消息分布、同步/异步、刷盘/复制、Producer/Consumer 数和下游耗时；测稳态、峰值、积压追平、Broker 故障和恢复时 P99。

## 验收题

- 为什么容量要同时计算 consumer egress？
- Queue 多有什么元数据/文件成本？
- 平均消息大小为何不足以定容？
- 追平积压需要怎样的净消费余量？

## 参考资料

- [RocketMQ best practices](https://rocketmq.apache.org/docs/bestPractice/01bestpractice/)
