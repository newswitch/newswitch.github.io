---
title: "Loki Label、Stream、Chunk、Index、对象存储与写读路径"
sidebar_label: "07. Loki 架构与数据路径"
sidebar_position: 7
description: "解释 Loki 为什么索引标签而非日志全文，并沿 Distributor、Ingester、对象存储和 Querier 分析写读路径。"
tags: [Loki, Label, Stream, Chunk, Index, 对象存储]
---

# Loki Label、Stream、Chunk、Index、对象存储与写读路径

Loki 把完全相同 Label Set 的日志组成一个 Stream。它主要索引 Label 和时间范围，日志正文保存在压缩 Chunk 中，因此 Label 设计决定查询效率、基数和成本。

## 1. 数据模型

```text
{cluster="prod", namespace="orders", app="api"}
  → (timestamp, log line)
  → Stream
  → Chunk
```

`request_id`、`trace_id`、用户 ID 等高基数字段通常留在结构化日志正文，通过解析过滤查询，不作为持久 Label。

## 2. 写入路径

```text
Agent/Collector
→ Distributor：鉴权、校验、限流、Hash
→ Ingester：按Stream写内存/WAL并构建Chunk
→ 对象存储：Chunk和索引数据
→ Compactor：索引压缩、保留/删除处理
```

具体组件随部署模式和版本不同，但应始终区分接收、实时缓冲、长期对象存储和后台维护。写入成功语义与副本、WAL 和部署模式有关，必须按实际配置验证。

## 3. 查询路径

```text
Grafana/Client
→ Query Frontend：切分、缓存、调度
→ Querier：读取近期Ingester与历史对象存储
→ 合并排序去重
→ 返回日志或Metric Query结果
```

精确 Label Selector 先缩小 Stream，再解析正文。先用 `{cluster,namespace,app}` 限定范围，再执行 JSON/正则过滤；无界扫描所有日志会造成查询风暴。

## 4. Label 治理

适合 Label：环境、集群、命名空间、服务、固定级别。谨慎使用 Pod 名，因为重建会增加 Stream；禁止 Request ID、文件全路径、错误文本和 URL 参数。

结构化 Metadata 或查询时解析可以保存高基数上下文而不创建新 Stream，具体能力按 Loki 版本确认。

## 5. 对象存储边界

对象存储延迟、权限、限流和生命周期会影响历史写入、查询和 Compaction。不要让 Bucket Lifecycle 比 Loki Retention 更早删除对象；启用版本/锁定也会改变实际删除和成本。

## 6. 排障

写入失败先查 Distributor 限流、时间戳、Label 和 Ingester；近期可查历史不可查时查对象存储、索引与 Store；查询慢时查 Stream 数、时间范围、正则、Frontend 切分和缓存。

参考：[Loki Architecture](https://grafana.com/docs/loki/latest/get-started/architecture/)。
