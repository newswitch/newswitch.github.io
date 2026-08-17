---
title: "Bulk、Ingest Pipeline、Logstash、Beats 与数据建模"
sidebar_position: 10
tags: [Elasticsearch, Bulk, Ingest Pipeline, Logstash]
description: "设计高吞吐摄取、转换、重试、失败队列与幂等文档模型。"
---

# Bulk、Ingest Pipeline、Logstash、Beats 与数据建模

```text
Agent/Beats → optional Logstash/Kafka
→ Bulk API → coordinating/ingest node
→ ingest processors → primary shard → replicas
```

## Bulk

Bulk 一次 HTTP 含多个独立 action，每项可成功或失败。客户端必须解析 `items[]`，只重试可重试项，并保留稳定 document ID 防止超时重试产生重复。

批次按压缩后/原始字节、文档数和目标延迟共同控制。过小浪费 RTT，过大增加 Heap、队列、失败范围和单次超时。并发逐步增加直到吞吐不再增长或 rejection/P99 恶化。

## Ingest Pipeline

Processor 可解析、重命名、GeoIP、脚本和失败处理。Pipeline 在写入路径消耗 CPU；复杂 Grok/Script 先 benchmark，必要时独立 ingest nodes。使用 `_simulate` 和版本化 pipeline。

## Logstash/Beats

Agent 负责轻量采集；Logstash 适合复杂缓冲、转换和多输出。Persistent Queue 与 Dead Letter Queue 有各自覆盖范围，必须监控容量和重放。Kafka 可进一步解耦峰值和重建。

## 建模

保留原始事件 ID、源时间、摄取时间、Schema version；动态字段白名单；大字段截断/外置；多行异常合并；敏感字段脱敏。时区和日期解析失败进入隔离索引/队列，不得静默丢弃。

## 验收题

- Bulk HTTP 200 为什么仍可能部分失败？
- 稳定 document ID 怎样帮助幂等？
- Ingest Pipeline 何时需要独立节点？
- DLQ 为什么必须有重放流程？

## 参考资料

- [Bulk API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk)
- [Ingest pipelines](https://www.elastic.co/docs/manage-data/ingest/transform-enrich/ingest-pipelines)
