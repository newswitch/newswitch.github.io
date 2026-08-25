---
title: "Debezium Lag、Queue、Snapshot、JMX/OTel、容量、安全与 HA"
sidebar_label: "11. 可观测性、容量与 HA"
sidebar_position: 11
description: "用来源水位、内部队列和输出延迟建立 Debezium 可观测性，完成容量、安全和高可用设计。"
tags: [Debezium, Observability, Capacity, HA]
---

# Debezium Lag、Queue、Snapshot、JMX/OTel、容量、安全与 HA

CDC 的“延迟”至少分为数据库提交到读取、连接器内部排队、Kafka 发送和消费者处理四段。只有端到端水位才能说明业务新鲜度。

## 1. 指标分层

| 层 | 核心信号 | 典型问题 |
| --- | --- | --- |
| 源数据库 | Binlog/LSN 差、WAL/日志保留、连接数 | 日志将过期、Slot 膨胀 |
| Snapshot | 当前表、剩余表、扫描行数、耗时 | 锁、慢查询、全表扫描 |
| Streaming | 最后事件时间、来源位置、处理事件数 | 无事件还是卡住 |
| Queue | 当前/最大容量、字节数 | Kafka 背压或批量不合理 |
| Kafka | Produce 延迟、错误、ISR | Broker 或网络瓶颈 |
| 下游 | Consumer Lag、落库时间、对账差异 | 消费者处理能力不足 |

JMX 指标可由 Prometheus JMX Exporter 暴露；OTel 用于统一指标、日志和 Trace。标签中避免放表名全集、Offset 等高基数值。

## 2. 端到端 SLI

为关键表周期写入 Heartbeat/Canary，记录数据库提交时间和目标可见时间。`CDC freshness = target_visible_time - source_commit_time`。同时保存来源位置，才能区分“业务没写入”和“链路卡住”。

## 3. 容量模型

估算峰值事件速率、平均/最大事件大小、序列化放大、快照吞吐和可容忍停机时间。内部 Queue 至少吸收短时抖动，但不能把它当长期缓存：Queue 越大，内存和故障重放窗口也越大。

压测矩阵应包含正常流量、峰值突发、大事务、大字段、DDL、Kafka 限速和恢复追赶。记录 CPU、Heap/GC、Queue、来源 Lag 与 Produce 延迟，找最先饱和的资源。

## 4. HA 的真实含义

Kafka Connect Distributed 可以在 Worker 失败后重新分配 Task，但同一 Source Task 通常只有一个活动实例。HA 是缩短恢复时间，不是同一日志被多个实例并行读取。内部 Topic、Kafka、数据库日志和网络都必须具备相应可用性。

## 5. 安全

数据库账号最小权限，数据库/Kafka 全链路 TLS；Secret 不进入 Connector Config 导出和日志；REST API 置于认证网关或受限网络；限制谁能修改 Connector，因为 SMT/插件和连接地址都属于执行边界。

## 6. 告警与动作

- 来源 Lag 接近日志保留窗口：立即扩展保留或恢复消费；
- Queue 持续高水位：检查 Kafka 和吞吐，不要只调大内存；
- Connector Running 但位置不推进：用 Canary 和数据库日志率确认；
- Snapshot 超预算：检查锁、扫描速率和数据库影响；
- Slot/WAL 占盘：先保全恢复坐标，再扩容或限流。

参考：[Debezium Monitoring](https://debezium.io/documentation/reference/stable/connectors/mysql.html#mysql-monitoring)、[OpenTelemetry Integration](https://debezium.io/documentation/reference/stable/integrations/otel.html)。
