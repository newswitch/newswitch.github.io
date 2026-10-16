---
title: "Series、Samples、WAL、查询并发、容量规划与性能优化"
sidebar_label: "12. 容量规划与性能优化"
sidebar_position: 12
description: "以 Active Series、Samples/s、Retention、WAL、规则和查询工作集为输入，建立可测量的 Prometheus CPU、内存、磁盘与网络容量模型。"
tags: [Prometheus, 容量规划, Active Series, Samples, 性能优化]
---

# Series、Samples、WAL、查询并发、容量规划与性能优化

Prometheus 成本的主要驱动不是 Target 数。十个 Target 也可能因用户 ID Label 产生数百万 Series；一万个轻量 Target 也可能运行稳定。容量规划必须同时描述写入路径和查询路径。

## 1. 六个核心输入

| 输入 | 主要影响 |
| --- | --- |
| Active Series | Head 内存、Index、WAL、GC |
| Samples/s | CPU、WAL、磁盘和 Remote Write 网络 |
| Series Churn | Series 创建、WAL、GC、Compaction |
| Retention | Block 磁盘和历史查询范围 |
| Rule 数与复杂度 | 周期性查询 CPU 和输出 Series |
| 查询并发/范围/Step | CPU、内存、Block 读取、返回流量 |

Target 数、指标名称数和数据目录大小都只是表象，不能单独作为扩容依据。

## 2. 写入量模型

若每条活跃 Series 每个抓取周期产生一个样本：

```text
samples_per_second ≈ active_series / scrape_interval_seconds
daily_samples = samples_per_second × 86400
```

示例：

```text
Active Series = 2,000,000
Scrape Interval = 30s
Samples/s ≈ 66,667
Daily Samples ≈ 5.76 billion
```

不同 Job 的间隔不同，应分别计算后求和。Recording Rule、Remote Write Receiver 和 Federation 也会新增写入，不能只计算 Scrape。

## 3. 磁盘模型

```text
Block容量 = daily_samples × measured_bytes_per_sample × retention_days
总盘 = Block + WAL + chunks_head + Compaction峰值 + Snapshot + 安全余量
```

Prometheus 官方常用 1～2 字节/样本作为粗估，但 Label、Chunk 压缩、Series 生命周期和工作负载会改变结果。应使用实际 Block 大小、样本数和至少一周增长率计算本环境字节/样本。

若按 1.5 字节/样本估算上例 30 天：

```text
5.76B × 1.5 × 30 ≈ 259GB Block数据
```

这不包括 WAL、Head、Compaction 新旧 Block 共存和故障追赶。400GB PVC 可能已经偏紧，不能看到 259GB 就配置 270GB。

使用 `--storage.tsdb.retention.size` 时保留 15%～20% 或经压测证明的更高安全余量，避免 Compaction 在接近满盘时失败。

## 4. 内存不能套固定“每 Series 字节”

Head 内存受以下因素共同影响：

- Active Series 和每条 Series 的 Label/Symbol；
- Head 中内存 Chunk 与 mmap Chunk；
- Native/Classic Histogram 结构；
- Scrape、Rule 和 Remote Write 队列；
- 并发查询的中间向量；
- Go Heap、GC 目标和文件 Page Cache。

不同版本和工作负载的每 Series 内存差异很大。正确方法是记录稳态 RSS/Heap、Active Series 和查询空闲基线，再在真实 Label 分布下逐级加压拟合，而不是引用一个互联网常数作为生产结论。

## 5. Series Churn

Churn 指 Series 快速创建和消失。典型来源：

- Pod UID、Container ID、Deployment Hash；
- 请求路径带订单号或模型 ID；
- Batch Job 每次产生新实例 Label；
- Exporter 动态枚举短生命周期对象；
- Recording Rule 保留易变 Label。

```promql
rate(prometheus_tsdb_head_series_created_total[5m])
rate(prometheus_tsdb_head_series_removed_total[5m])
```

Active Series 稳定不代表没有 Churn：每分钟创建和删除同样数量的 Series，稳态总数不变，但 WAL、GC 和 Index 仍持续承压。

## 6. 基数分析方法

结合 TSDB Status 和 `promtool tsdb analyze` 查找：

```text
Series count by metric name
Label value count by label name
Highest-cardinality label pairs
Churning label pairs
Compaction statistics
```

治理顺序：

1. 删除源头无界 Label；
2. 把原始 Path 规范化为 Route Template；
3. 缩减 Exporter Collector；
4. Metric Relabel 丢弃不使用的指标；
5. Recording Rule 降维供常用查询；
6. 设置 Sample/Label/Series 限制作为保险丝。

删除前查询 Dashboard、Rule、API 和报表依赖，避免为了省容量破坏告警。

## 7. Scrape 压力

一次 Scrape 成本包括连接/TLS、目标计算、Body 传输、解析、Relabel 和写 WAL。关注：

```promql
scrape_duration_seconds / scrape_timeout_seconds
scrape_samples_scraped
scrape_samples_post_metric_relabeling
scrape_series_added
```

大量 Target 在同一时刻启动、证书频繁握手、Exporter 查询慢和 Body 巨大都可能让 Scrape 接近 Timeout。增加 Scrape Interval 会降低 Samples/s，但也降低时序分辨率和故障发现速度。

## 8. 查询成本模型

粗略理解：

```text
成本 ≈ 匹配Series数 × 每Series时间范围内样本数
     + Join/聚合中间向量
     + 返回点数
```

危险模式：

- 没有 Cluster/Job 限定的大正则；
- 30 天范围配 15 秒 Step；
- Many-to-many 或高基数 Group Left；
- 嵌套 Subquery；
- 每个 Dashboard 用户重复执行同一重查询；
- 一个告警组同时运行大量复杂表达式；
- Grafana 1 秒自动刷新。

优化顺序：缩小 Selector、合理 Step/范围、减少输出 Label、Recording Rule、Query Frontend/缓存、限制并发和超时，最后再扩资源。

## 9. Rule 容量

规则是周期性固定查询。设 30 秒 Interval 的查询即使没人打开 Grafana也会永久运行。

需要跟踪：

- 每组 Evaluation Duration 与 Interval 比值；
- Missed Iterations 和 Evaluation Failures；
- 每条 Recording Rule 输出 Series；
- 各组是否在同一秒集中执行；
- 规则对 Head 与历史 Block 的读取范围。

将相互依赖的规则放在同组并按顺序执行；独立重查询分散到不同组/评估周期，减少尖峰。

## 10. Remote Write 容量

网络粗估：

```text
remote_write_bytes/s
≈ samples/s × 实测压缩后字节/样本 × 副本/目的端数量
```

实际还包含 Series Metadata、Exemplar、Native Histogram 和 HTTP 开销。远端中断恢复时，追赶速率必须大于当前生成速率才能清空积压：

```text
净追赶速率 = 发送能力 - 当前写入速率
追平时间 ≈ 积压样本 / 净追赶速率
```

提高 Shard 会同时增加发送端内存、连接和后端压力，必须联动后端配额。

## 11. CPU、I/O 和 GC 判断

| 资源异常 | 优先检查 |
| --- | --- |
| CPU 高 | PromQL/Rule、Scrape 解析、Series 创建、Compaction |
| RSS/Heap 高 | Active Series、查询并发、队列、GC、内存泄漏 |
| 磁盘延迟高 | WAL fsync、Compaction、Snapshot、大查询 Page Fault |
| 网络高 | Scrape Body、Remote Write、Query 返回、对象存储 |
| FD 高 | Target 连接、并发查询、TSDB 文件、Sidecar |

CPU 利用率不高但查询慢时，还要检查单核热点、磁盘等待、锁竞争、GC Pause、查询排队和下游消费速度。

## 12. 分片与副本

副本提高可用性但不降低单副本负载；每个副本仍抓取完整目标。分片把目标集合拆开，降低每个实例的 Series 和 Samples/s，但扩大运维复杂度。

```text
2 Shards × 2 Replicas
Shard 0: Prometheus 0a/0b
Shard 1: Prometheus 1a/1b
```

扩分片会重新分配 Target，产生 Series Churn、缓存冷启动和 Remote Write 变化。全局查询与规则必须理解分片边界。

## 13. 压测与容量报告

测试步骤：

1. 采集真实 Label 分布和指标类型；
2. 建立当前 Series、Samples/s、查询与规则基线；
3. 分级增加 Target/Series，不只提高请求数；
4. 重放常用 Dashboard、Rule 和最坏查询；
5. 模拟 Remote Write 中断后追赶；
6. 强制重启测 WAL Replay；
7. 触发 Compaction 与 Snapshot 并发；
8. 输出拐点和 30/60/90 天扩容触发条件。

容量报告至少包含稳态、峰值、单副本故障、查询 P95/P99、Rule Miss、Scrape Miss、WAL Replay、磁盘峰值和安全余量。

## 14. 练习与答案

**问题：Target 数不变，内存为什么一夜翻倍？**

答案：可能新增高基数 Label、Histogram Bucket、Recording Rule 或查询并发；Target 数无法反映 Series 和工作集变化。

**问题：把 Retention 从 30 天降到 15 天，内存会减半吗？**

答案：通常不会。Retention 主要影响历史 Block 磁盘；Head 内存更受 Active Series 和近期写入影响。

## 15. 参考资料

- [Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/)
- [Prometheus Remote Write Tuning](https://prometheus.io/docs/practices/remote_write/)
- [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)
- [Prometheus Benchmarking Tools](https://github.com/prometheus/prometheus/tree/main/documentation/examples)
