---
title: "Prometheus TSDB、Head、WAL、Block、Compaction 与 Retention"
sidebar_label: "04. TSDB、WAL 与 Block"
sidebar_position: 4
description: "沿样本写入、WAL、Head、不可变 Block、索引、压缩和保留策略理解 Prometheus 本地 TSDB，并掌握恢复与磁盘故障边界。"
tags: [Prometheus, TSDB, WAL, Block, Compaction, Retention]
---

# Prometheus TSDB、Head、WAL、Block、Compaction 与 Retention

Prometheus 本地 TSDB 不是“把每个指标写入一个文件”。每组完全相同的 Metric Name 与 Labels 形成一条 Series，样本先进入当前 Head，通过 WAL 获得崩溃恢复能力，再周期性落成不可变 Block。

```text
Scrape Samples
→ Label Set计算Series Ref
→ WAL追加Series/Sample记录
→ Head内存索引与Chunk
→ Head Chunk mmap落盘
→ 约2小时形成Block
→ 后台Compaction合并Block
→ Retention删除完全过期的Block
```

## 1. Series、Sample、Chunk 和 Index

```text
http_requests_total{cluster="prod",instance="10.0.0.1:8080",code="200"}
```

这一完整 Label Set 标识一条 Series。时间戳和值构成 Sample；连续样本被压缩进 Chunk；Index 用于根据 Label Matcher 找到 Series 和 Chunk 位置。

高基数首先增加 Series 对象、倒排索引和 Head 内存，而不仅是多占一点磁盘。频繁创建又消失的 Label 值会产生高 Churn，增加 WAL、GC 和 Compaction 压力。

## 2. Head 是什么

Head 保存尚未形成持久 Block 的最新时段，包括：

- 当前活跃 Series 与倒排索引；
- 尚在写入的内存 Chunk；
- 已封闭并映射到 `chunks_head` 的 Head Chunk；
- WAL/Checkpoint 对应的恢复状态。

查询最近数据会读取 Head，查询历史区间则同时读取相关 Block。Prometheus 的内存占用通常与 Active Series、Label 数量、抓取并发和查询工作集强相关。

## 3. WAL 与 Checkpoint

WAL 先顺序记录新 Series、样本和元数据，使 Prometheus 崩溃后可以重建尚未进入 Block 的 Head。WAL 使用分段文件；Checkpoint 会把仍需要的记录压缩到新的检查点，以减少后续重放量。

```text
data/
├─ wal/
│  ├─ 00000042
│  ├─ 00000043
│  └─ checkpoint.00000041/
├─ chunks_head/
└─ 01J.../                 # 持久Block ULID目录
```

启动日志示意：

```text
level=info msg="Replaying on-disk memory mappable chunks if any"
level=info msg="WAL segment loaded" segment=42 maxSegment=47
level=info msg="WAL replay completed" duration=38.2s
```

WAL Replay 很慢时，应检查 Active Series、WAL 大小、磁盘延迟、上次是否正常停止以及是否发生高 Churn。不要把删除 WAL 当常规加速手段，它会丢失尚未进入 Block 的数据。

## 4. Block 的磁盘结构

```text
01JABC.../
├─ chunks/
│  ├─ 000001
│  └─ 000002
├─ index
├─ meta.json
└─ tombstones
```

- `chunks`：压缩后的样本数据；
- `index`：Label/Series 到 Chunk 的索引；
- `meta.json`：时间范围、ULID、Compaction 层级和统计信息；
- `tombstones`：删除 API 产生的逻辑删除区间。

Block 不在原地修改。不可变性让并发查询和压缩更简单，但 Compaction 期间新旧 Block 会暂时共存。

## 5. Compaction 为什么需要额外空间

```text
多个小Block
→ 读取Index与Chunk
→ 去重并应用Tombstone
→ 写出新的更大Block
→ 校验完成
→ 删除源Block
```

写出完成前不能删源 Block，因此磁盘峰值可能明显高于稳态。使用 Size Retention 时必须给磁盘留出余量，不能把限制设到 PVC 的 100%。Compaction 与大查询、Snapshot、Remote Write 同时发生时还会竞争 I/O。

## 6. Retention 的真实语义

```bash
--storage.tsdb.retention.time=30d
--storage.tsdb.retention.size=400GB
```

同时设置时间和空间时，先触发的条件生效。时间保留按整个 Block 判断，只有 Block 完全过期才能删除；后台清理不是即时发生。

```text
每日样本 = Active Series × 86400 / Scrape Interval
Block数据 ≈ 每日样本 × 实测压缩后字节/样本 × 保留天数
总盘 = Block + WAL + Head Chunk + Compaction峰值 + 安全余量
```

官方给出的 1～2 字节/样本只能用于早期粗估，最终必须以本环境 `promtool tsdb analyze` 和磁盘增长率校准。

## 7. 本地盘、网络盘与副本

- 单实例数据目录不能由两个 Prometheus 同时写；
- 本地 TSDB 没有内建跨节点复制；
- NFS/EFS 等网络文件系统不受官方支持作为本地 TSDB；
- 两副本 HA 是独立抓取、独立 WAL、独立 Block，不是共享盘；
- 长期留存和全局查询可使用 Remote Write、Thanos 或 Mimir 等架构。

## 8. 查询怎样读取数据

```text
PromQL Label Matcher
→ Index求交/求差找到Series
→ 根据时间范围定位Head Chunk与Block Chunk
→ 解码样本
→ 执行rate/聚合/Join等算子
```

正则匹配大量 Label 值、长时间范围、小 Step 和大规模 Join 会扩大读取与计算。Block 在磁盘并不意味着查询不使用内存：索引、Chunk、查询中间向量和 Page Cache 都会占资源。

## 9. 关键自监控证据

```promql
prometheus_tsdb_head_series
rate(prometheus_tsdb_head_samples_appended_total[5m])
rate(prometheus_tsdb_head_series_created_total[5m])
prometheus_tsdb_wal_storage_size_bytes
prometheus_tsdb_storage_blocks_bytes
rate(prometheus_tsdb_compactions_total[1h])
prometheus_tsdb_compactions_failed_total
```

具体指标名称可能随版本演进，应先在当前 Prometheus 的 `/metrics` 验证，不要直接导入旧看板后假设数据存在。

## 10. 典型故障与判断

| 现象 | 可能层次 | 应保存的证据 |
| --- | --- | --- |
| 启动长时间不可用 | WAL Replay、磁盘慢、高 Churn | 启动日志、WAL 大小、I/O 延迟 |
| 磁盘突然增长 | 新 Series、抓取间隔、WAL/Compaction | Head Series、Samples/s、Block 列表 |
| Compaction 失败 | 空间不足、权限、损坏 | Error Log、Block ULID、磁盘水位 |
| 最近数据有、历史缺失 | Retention、Block 丢失、查询入口 | `meta.json`、保留配置、Store 状态 |
| OOM | Head 基数、并发查询、大 Join | Heap、Series、Query Log、GC |
| Duplicate/Out-of-order | 重复写入、时间戳、HA 去重 | Ingest 日志、Label Set、源时间 |

发生损坏时先停止反复重启，复制数据目录并记录版本、日志和损坏 ULID。优先从经过验证的 Snapshot 恢复；删除 Block 或 WAL 是有明确数据损失的最后手段。

## 11. 观察 Block 和 Head

```bash
du -sh /var/lib/prometheus/*
promtool tsdb list /var/lib/prometheus
promtool tsdb analyze /var/lib/prometheus
```

示意输出：

```text
Block ID: 01JABCDEF...
Duration: 2h0m0s
Series: 842315
Samples: 50382140
Label pairs most involved in churning: pod=...
```

生产数据目录操作前确认当前版本的参数和只读边界，优先在 Snapshot 或副本上分析。

## 12. 实验与答案

**实验：** 记录稳态 Head Series、WAL 大小和 Samples/s；加入一个每次请求都变化的 Label，运行 15 分钟后重新比较，再移除该 Label并观察旧 Series 的生命周期。

**问题：磁盘扩容后为什么 Prometheus 仍可能启动很慢？**

答案：扩容消除了空间不足，但没有减少需要重放的 WAL、Active Series 或磁盘延迟，也没有修复损坏 Block。

**问题：两个 Prometheus 副本能否挂到同一个 PVC？**

答案：不能。它们是两个独立 TSDB Writer，应使用独立数据目录，在查询层做 HA 去重。

## 13. 参考资料

- [Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/)
- [Prometheus TSDB Format](https://github.com/prometheus/prometheus/blob/main/tsdb/docs/format/README.md)
- [Prometheus Command-Line Flags](https://prometheus.io/docs/prometheus/latest/command-line/prometheus/)
