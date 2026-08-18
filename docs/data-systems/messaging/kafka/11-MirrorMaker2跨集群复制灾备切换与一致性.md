---
title: "MirrorMaker 2、跨集群复制、灾备切换与一致性"
sidebar_label: "11. MirrorMaker 2、跨集群复制、灾备切换与一致性"
sidebar_position: 11
description: "理解 MM2 Topic/Offset/ACL 复制、命名、Lag、切换和回切。"
tags: [Kafka, MirrorMaker 2, Disaster Recovery]
---

# MirrorMaker 2、跨集群复制、灾备切换与一致性

Kafka 推荐每个数据中心部署本地集群，通过跨集群复制连接，而非让一个 KRaft/Broker quorum 跨高延迟 WAN。

```text
source Kafka → MirrorSourceConnector → target topics
             → checkpoints/heartbeats
             → optional ACL/config sync
```

## 1. Topic 命名 {/* #topic-命名 */}

MM2 默认可加源集群 alias，避免环路和冲突。Active-Passive 最简单；Active-Active 必须定义 key ownership、冲突和环路，不会自动形成全局严格顺序。

## 2. Offset {/* #offset */}

Checkpoint 记录源/目标 offset 映射，消费者切换需同步/转换 Group offset。Topic 数据已追平不等于 Group 可无缝继续；切换前验证目标消息、offset 映射和应用幂等。

## 3. 一致性 {/* #一致性 */}

跨集群异步复制存在 RPO。网络中断、Connector 停止和目标限流都会增加 lag；重复可能发生，顺序只在特定 partition 流内讨论。

## 4. 切换 {/* #切换 */}

```text
fence source producers
→ wait replication/checkpoint to target RPO
→ translate consumer offsets
→ start target consumers/producers
→ validate sequence and lag
```

回切前建立反向复制/差异收敛，避免直接指回旧集群丢失灾备期间新写。

## 5. 灾备演练：先定义数据契约 {/* #灾备演练先定义数据契约 */}

MirrorMaker 2 基于 Kafka Connect 复制 Topic，并通过 checkpoint/heartbeat 辅助迁移消费位置；它不是同步复制，也不会自动把目标集群变成无损主集群。先固定 Kafka/Connect 4.x 版本，明确 Topic 选择、命名策略、ACL/配置同步范围和环路防护。

```bash
curl -s http://connect:8083/connectors/mm2/status
kafka-consumer-groups.sh --bootstrap-server target:9092 --describe --group <group>
kafka-topics.sh --bootstrap-server target:9092 --describe --topic <replicated-topic>
```

持续产生带序号与业务键的数据，断开源集群，记录目标最大序号、复制 lag、checkpoint 年龄、消费者切换位置、重复和缺口，得到实际 RPO/RTO。故障切换要有写入围栏，避免双主；回切时明确哪一侧是权威数据。事务边界、完全相同的 offset、ACL 和 Topic 配置不能假设自动保持，必须逐项验证。

## 6. 验收题 {/* #验收题 */}

- 为什么不建议单 Kafka 集群跨 WAN？
- 数据 lag 为零为何消费 offset 仍可能不对？
- Active-Active 如何避免复制环路？
- Failback 为何需要反向收敛？

## 7. 参考资料 {/* #参考资料 */}

- [Kafka geo-replication](https://kafka.apache.org/40/operations/geo-replication/)
- [Kafka datacenters](https://kafka.apache.org/40/operations/datacenters/)
