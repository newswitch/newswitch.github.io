---
title: "Kafka 从零到精通学习路线"
sidebar_label: "00. Kafka 从零到精通学习路线"
sidebar_position: 0
tags: [Kafka, KRaft, 消息队列, 流处理, 学习路线]
description: "在现有 Kafka 原理文章基础上，补齐 KRaft 多种部署、安全、协议源码、跨集群灾备与生产验收，形成从零到精通路线。"
---

# Kafka 从零到精通学习路线

Kafka 已有分区日志、Producer、Consumer Group、复制、事务、容量和积压治理文章。本轮不重写，而是把它们组织成完整路线，并补齐部署、安全、协议源码和跨集群灾备。

主线使用 **Apache Kafka 4.x + KRaft**。ZooKeeper 架构只用于理解历史迁移，不再作为新建生产集群默认方案；关键生产集群分离 Controller 与 Broker 角色。

## 1. 端到端路径

```text
Producer Record
  → serialization / partitioner / accumulator batch
  → broker network thread / request queue / I/O thread
  → leader partition log / page cache
  → follower fetch / ISR / high watermark
  → fetch response
  → consumer group assignment / fetch
  → application processing
  → offset commit / downstream transaction
```

## 2. 13 篇路线

| 编号 | 文章 | 优先级 | 状态 |
| --- | --- | --- | --- |
| K00 | Kafka 从零到精通学习路线 | P0 | 已完成 |
| K01 | [Kafka 架构、分区日志、Segment 与索引](./01-Kafka架构分区日志Segment与索引.md) | P0 | 已完成 |
| K02 | [Producer Batching、Acks、重试与幂等](./02-Producer-Batching-Acks重试与幂等.md) | P0 | 已完成 |
| K03 | [Consumer Group、Offset、Rebalance 与顺序](./03-Consumer-Group-Offset-Rebalance与顺序.md) | P0 | 已完成 |
| K04 | [副本、ISR、Leader 选举与 KRaft](./04-副本ISR-Leader选举与KRaft.md) | P0 | 已完成 |
| K05 | [Kafka 事务与端到端 Exactly-Once](./05-Kafka事务与端到端Exactly-Once.md) | P1 | 已完成 |
| K06 | [Topic、Partition、磁盘、网络与容量规划](./06-Topic-Partition磁盘网络与容量规划.md) | P0 | 已完成 |
| K07 | [Kafka 积压、故障排查、滚动升级与 Kubernetes](./07-Kafka积压故障排查滚动升级与Kubernetes.md) | P1 | 已完成 |
| K08 | [KRaft 单机、分离角色集群、Docker 与 Kubernetes 部署](./08-Kafka-KRaft单机分离角色Docker与Kubernetes部署.md) | P0 | 已完成 |
| K09 | [TLS、SASL、ACL、配额与多租户安全](./09-Kafka-TLS-SASL-ACL配额与多租户安全.md) | P1 | 已完成 |
| K10 | [Network Thread、Request Handler、Replica Fetch 与源码路径](./10-Kafka网络线程请求处理副本拉取与源码路径.md) | P2 | 已完成 |
| K11 | [MirrorMaker 2、跨集群复制、灾备切换与一致性](./11-MirrorMaker2跨集群复制灾备切换与一致性.md) | P1 | 已完成 |
| K12 | [生产验收、监控告警、基准测试与故障演练](./12-Kafka生产验收监控基准与故障演练.md) | P1 | 已完成 |

当前完成 **13/13**，剩余 **0 篇**。命令实验已有 [Kafka Topic、Producer、Consumer 与 Group 命令手册](./13-Kafka-Topic-Producer-Consumer与Group命令手册.md)，作为 K01～K12 的动手参考。

## 3. 学习顺序

1. K01：理解 append-only log、Segment、Offset 和 Page Cache；
2. K02～K03：分别沿发送与消费路径追踪批处理、重试、顺序和重平衡；
3. K04～K05：理解 ISR/HW、KRaft 元数据和 Exactly-Once 的边界；
4. K06～K07：做容量、积压、升级和故障治理；
5. K08～K12：补齐可复现部署、安全、源码、跨集群与验收。

## 4. P0 验收题

- `acks=all` 为什么不等于绝对不丢消息？
- Producer 幂等解决哪些重复，无法解决哪些业务重复？
- Consumer 已处理但尚未提交 Offset 时崩溃会发生什么？
- ISR、LEO、High Watermark 分别表示什么？
- KRaft Controller Quorum 与 Broker 副本 ISR 是不是同一套多数派？
- Partition 增加后为何原有 Key 的全局映射可能改变？
- Lag 很高时应增加 Consumer、Partition 还是先修下游？
- MirrorMaker 复制完成是否代表消费组、事务和业务切流全部完成？

## 5. 部署学习要求

K08 必须覆盖：

```text
开发：combined broker,controller
生产：3/5 Controller + 独立 Broker
制品：二进制/systemd、Docker、Kubernetes Operator/Chart
初始化：cluster.id、storage format、metadata.version
安全：首次即启 TLS/SASL/ACL
验收：controller quorum、ISR、produce/consume、滚动重启
```

Apache Kafka 官方文档明确指出 combined 模式便于小环境，但不推荐关键生产环境，因为 Controller 与 Broker 无法独立滚动和伸缩。

## 6. 官方资料

- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Kafka 4.0 KRaft Operations](https://kafka.apache.org/40/operations/kraft/)
- [Apache Kafka Source](https://github.com/apache/kafka)

最终能力不是会执行 `kafka-topics.sh`，而是面对延迟、积压、选主和数据差异时，能沿 Producer、Broker Log、Replica、Consumer 和下游事务找到证据。
