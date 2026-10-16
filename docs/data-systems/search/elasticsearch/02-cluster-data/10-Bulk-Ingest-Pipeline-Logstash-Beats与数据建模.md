---
title: "Bulk、Ingest Pipeline、Logstash、Beats 与数据建模"
sidebar_label: "10. Bulk、Ingest Pipeline、Logstash、Beats 与数据建模"
sidebar_position: 10
description: "设计高吞吐摄取、转换、重试、失败队列与幂等文档模型。"
tags: [Elasticsearch, Bulk, Ingest Pipeline, Logstash]
---

# Bulk、Ingest Pipeline、Logstash、Beats 与数据建模

```text
Agent/Beats → optional Logstash/Kafka
→ Bulk API → coordinating/ingest node
→ ingest processors → primary shard → replicas
```

## 1. Bulk {/* #bulk */}

Bulk 一次 HTTP 含多个独立 action，每项可成功或失败。客户端必须解析 `items[]`，只重试可重试项，并保留稳定 document ID 防止超时重试产生重复。

批次按压缩后/原始字节、文档数和目标延迟共同控制。过小浪费 RTT，过大增加 Heap、队列、失败范围和单次超时。并发逐步增加直到吞吐不再增长或 rejection/P99 恶化。

## 2. Ingest Pipeline {/* #ingest-pipeline */}

Processor 可解析、重命名、GeoIP、脚本和失败处理。Pipeline 在写入路径消耗 CPU；复杂 Grok/Script 先 benchmark，必要时独立 ingest nodes。使用 `_simulate` 和版本化 pipeline。

## 3. Logstash/Beats {/* #logstashbeats */}

Agent 负责轻量采集；Logstash 适合复杂缓冲、转换和多输出。Persistent Queue 与 Dead Letter Queue 有各自覆盖范围，必须监控容量和重放。Kafka 可进一步解耦峰值和重建。

## 4. 建模 {/* #建模 */}

保留原始事件 ID、源时间、摄取时间、Schema version；动态字段白名单；大字段截断/外置；多行异常合并；敏感字段脱敏。时区和日期解析失败进入隔离索引/队列，不得静默丢弃。

## 5. 可执行实验：逐项处理 Bulk 结果 {/* #可执行实验逐项处理-bulk-结果 */}

```http
PUT _ingest/pipeline/logs_lab
{"processors":[{"set":{"field":"ingested_at","value":"{{{_ingest.timestamp}}}"}}],"on_failure":[{"set":{"field":"error.message","value":"{{{_ingest.on_failure_message}}}"}}]}

POST _ingest/pipeline/logs_lab/_simulate
{"docs":[{"_source":{"message":"ok"}}]}
```

Bulk 请求必须以 NDJSON 发送且最后有换行。HTTP 200 只表示整个批次被接收，应用仍要遍历 `items[*].status/error`，对 429/503 做有界退避，对 mapping/权限类永久错误进入 DLQ，不能无限重试。

批大小用字节数和端到端延迟调节，不以固定文档条数照搬。压测时记录生产速率、bulk 大小、并发、rejection、ingest CPU、merge、refresh、磁盘和失败率。Logstash/Beats 的 persistent queue 只能缓冲，不能替代源端幂等、DLQ 与重放对账。

## 6. 验收题 {/* #验收题 */}

- Bulk HTTP 200 为什么仍可能部分失败？
- 稳定 document ID 怎样帮助幂等？
- Ingest Pipeline 何时需要独立节点？
- DLQ 为什么必须有重放流程？

## 7. 参考资料 {/* #参考资料 */}

- [Bulk API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk)
- [Ingest pipelines](https://www.elastic.co/docs/manage-data/ingest/transform-enrich/ingest-pipelines)
