---
title: "Debezium 解决什么问题与一条变更事件的完整路径"
sidebar_label: "01. Debezium 与一条 CDC 事件"
sidebar_position: 1
description: "从数据库提交、事务日志、Snapshot、Offset 到 Kafka 事件和消费者，分析 CDC 端到端语义。"
tags: [Debezium, CDC, Binlog, WAL, Snapshot, Offset]
---

# Debezium 解决什么问题与一条变更事件的完整路径

Debezium 从数据库事务日志捕获已经提交的数据变化，使下游能够构建搜索索引、缓存、数仓、审计和事件驱动服务。它避免按更新时间轮询漏数，但不会自动让所有下游获得 Exactly-once 业务结果。

## 1. 完整数据路径

以 MySQL 为例：

```text
Application事务
→ InnoDB提交并写Binlog
→ Debezium读取Binlog Event
→ 依据Schema History解释行格式
→ 生成Key、Envelope和Source Position
→ 更新Source Offset
→ Kafka Connect写目标Topic与Offset内部Topic
→ Consumer读取事件
→ 幂等写Elasticsearch/ClickHouse/Redis
→ 提交Consumer Offset
```

PostgreSQL 对应 WAL、Logical Decoding、Publication 和 Replication Slot。数据库日志是事实变化来源，Debezium Event 是对源日志和 Schema 的转换结果。

## 2. 初始 Snapshot 与持续 Streaming

CDC 启动时通常既要获得现有全量数据，又要保证 Snapshot 期间的新事务不丢：

```text
记录一致起点
→ 读取表Schema和现有行（op=r）
→ 持久化Snapshot进度
→ 从已记录日志位置继续Streaming
```

不同数据库连接器使用的锁、隔离级别和 Snapshot 算法不同。大型表 Snapshot 会占用数据库 I/O、网络、Connector Queue 和 Kafka，必须限速并在业务低峰验证。

## 3. Event Envelope

典型变更值包含：

| 字段 | 含义 |
| --- | --- |
| `before` | 变化前行，取决于数据库日志配置 |
| `after` | 变化后行 |
| `op` | `c/u/d/r` 等操作类型 |
| `source` | 数据库、表、日志位置、Snapshot 状态等来源信息 |
| `ts_ms/us/ns` | 源事件或 Connector 处理时间，按连接器字段解释 |
| `transaction` | 可选事务元数据 |

事件 Key 通常来自表主键，决定 Kafka Partition 和下游幂等基础。无主键表、主键变更和 Topic Routing 都需要单独设计。

## 4. 三类持久状态

```text
Source Database Log：可继续读取的源历史
Source Offset：已经处理到什么日志位置/Snapshot阶段
Schema History：该位置的表结构如何解释
```

三者必须匹配。只删除 Offset 可能触发重复 Snapshot；只丢 Schema History 可能无法解释后续 Binlog；源日志已经清理而 Offset 太旧时无法继续，只能恢复日志或重新建立一致基线。

## 5. 交付语义

常见 CDC 链路以至少一次为基础。以下故障可能产生重复：

- 事件已写 Kafka，但 Offset 尚未提交；
- Connector 重启回到较早 Source Position；
- Kafka Connect Task Rebalance；
- 下游完成写入但尚未提交 Consumer Offset；
- 人工重置 Offset 或重放 Topic。

消费者应使用 `source` 位置、事件 Key、业务版本或唯一约束实现幂等。不能依赖“我观察到没有重复”来证明 Exactly-once。

## 6. 事务与顺序

源数据库在一个事务中可修改多表多行。Debezium 能按源日志顺序输出事件，并可提供事务边界元数据，但 Kafka Topic 分表、Partition 和下游并行会改变全局观察顺序。

如果业务要求“订单和明细原子可见”，需要在消费端缓存事务、使用 Outbox 聚合业务事件，或允许最终一致并设计状态机。

## 7. 延迟分解

```text
CDC Lag = 数据库提交到Connector读取
        + Connector转换与队列
        + Kafka Produce/复制
        + Consumer Lag
        + 下游写入
```

只看 Kafka Consumer Lag 无法判断 Connector 是否卡在 Snapshot 或源数据库日志。应分别记录源位置、事件 Source Timestamp、Connector Processing Time 和下游完成时间。

## 8. 故障定位

| 现象 | 优先检查 |
| --- | --- |
| 没有新事件 | 数据库日志配置/权限、Connector 状态、过滤规则 |
| 事件延迟增加 | 源 Lag、内部 Queue、Kafka、消费者和 Sink |
| Connector 无法恢复 | Offset、Schema History、源日志保留 |
| 删除后下游仍有数据 | Delete Event/Tombstone 与消费者语义 |
| DDL 后解析失败 | Schema History、DDL 支持和消费者 Schema 兼容 |
| 重复事件 | 重启/重平衡、Offset 提交和消费幂等 |

## 9. 验收实验

在 Snapshot 期间持续 INSERT/UPDATE/DELETE，验证每个主键最终状态和事件来源位置；随后停止 Connector、制造新事务并重启，确认从 Offset 续读。最后让消费者在写成功后、提交 Offset 前退出，证明下游幂等有效。

参考：[Debezium Architecture](https://debezium.io/documentation/reference/stable/architecture.html)、[Debezium Tutorial](https://debezium.io/documentation/reference/stable/tutorial.html)。
