---
title: "异步 INSERT、Batch、Kafka Engine、去重与一致性"
sidebar_label: "08. 异步 INSERT、Batch、Kafka Engine、去重与一致性"
sidebar_position: 8
tags: [ClickHouse, Async Insert, Kafka Engine, Deduplication]
description: "设计 ClickHouse 高吞吐摄取、异步确认、Kafka 消费、去重和可重放链路。"
---

# 异步 INSERT、Batch、Kafka Engine、去重与一致性

小批高频 INSERT 产生大量 Part。客户端批量或 Async Insert 在服务端缓冲多请求再写 Part，以延迟/内存换吞吐。

## Async Insert

`wait_for_async_insert` 决定客户端是否等待缓冲数据真正写入。若不等待，服务异常可能让客户端误以为已成功；关键数据应等待确认并监控 async queue/error。按 query shape/settings 分缓冲，参数过多会碎片化批次。

## Kafka Engine

```text
Kafka topic → Kafka Engine consumers
→ Materialized View → MergeTree target
→ commit Kafka offset
```

异常窗口可能造成重复，目标表/业务需 event ID、version 或可合并引擎幂等。Schema/解析失败会阻塞或跳过，必须隔离坏消息并保留重放。

## 去重

Insert block dedup、replicated dedup window、ReplacingMergeTree 各有时间/键边界，不是全局唯一约束。记录 source topic/partition/offset 或 event ID，审计重复和缺口。

## 验收题

- Async Insert 不等待有什么 RPO？
- Kafka offset 与 ClickHouse 写入之间为何可能重复？
- ReplacingMergeTree 何时才收敛？
- 为什么小 INSERT 会制造 Part explosion？

## 参考资料

- [Asynchronous inserts](https://clickhouse.com/docs/optimize/asynchronous-inserts)
- [Kafka table engine](https://clickhouse.com/docs/engines/table-engines/integrations/kafka)
