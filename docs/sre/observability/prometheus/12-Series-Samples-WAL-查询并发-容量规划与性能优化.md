---
title: "Series、Samples、WAL、查询并发、容量规划与性能优化"
sidebar_label: "12. 容量规划与性能优化"
sidebar_position: 12
description: "以 Active Series、Samples/s、Retention 和查询工作集为输入，建立 Prometheus 内存、磁盘和 CPU 容量模型。"
tags: [Prometheus, 容量规划, Active Series, Samples, 性能优化]
---

# Series、Samples、WAL、查询并发、容量规划与性能优化

Prometheus 成本的主要驱动不是 Target 数，而是 Active Series、每秒样本数、Label 基数、保留期和查询扫描量。十个 Target 也可能因为无界标签产生百万 Series。

## 1. 基本模型

```text
samples_per_second = active_series / scrape_interval
daily_samples = samples_per_second × 86400
disk = daily_samples × measured_bytes_per_sample × retention × safety_factor
```

内存还受每条活跃时序、Head Chunk、Symbol/Label、WAL 缓冲和并发查询影响。用 `/api/v1/status/tsdb`、运行指标和真实数据目录测量本环境参数。

## 2. 基数分析

重点寻找：

- `user_id/request_id/session_id` 等无界 Label；
- `path` 未模板化，实际包含对象 ID；
- Pod UID、容器哈希等易变 Label 被长期保留；
- Histogram Bucket 过多；
- Exporter 默认暴露大量无用指标；
- Recording Rule 组合了不必要维度。

删除指标前确认 Dashboard、告警和容量报表没有依赖，并在 Metric Relabel 和应用埋点两侧评估成本。

## 3. 查询成本

查询成本近似取决于匹配 Series 数 × 时间范围样本数。常见高成本模式：无 Job/Cluster 限定、正则匹配所有值、范围过长且 Step 太小、Many-to-many Join、嵌套 Subquery、重复实时计算。

优化顺序：缩小 Selector → 调整 Step/范围 → 使用 Recording Rule → 限制并发/超时 → 缓存/Query Frontend。不能只增加内存掩盖无界查询。

## 4. 容量水位

磁盘同时预留 Retention、WAL、Compaction 临时空间和故障追赶余量。内存按故障时副本接管和查询峰值规划。远程写恢复会与正常抓取争夺 CPU/网络，压测必须覆盖后端中断后追赶。

## 5. 基准测试步骤

1. 记录目标、Series、Samples/s、规则数和查询并发；
2. 加载真实 Label 分布；
3. 运行常用 Dashboard 与告警；
4. 模拟 Target 增长和 Remote Write 中断；
5. 重启测 WAL Replay；
6. 验证 P95/P99 查询、规则错过和资源水位；
7. 给出 30/60/90 天扩容触发点。

## 6. 性能故障判断

CPU 高先查查询和规则；内存高查 Active Series/并发查询；磁盘高查 Retention、Series 和 Compaction；网络高查抓取负载、远程写和查询返回量。必须用分层证据定位，不能统一归因于“Prometheus 太重”。

参考：[Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/)、[Operational Aspects](https://prometheus.io/docs/prometheus/latest/querying/api/)。
