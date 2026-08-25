---
title: "Prometheus TSDB、Head、WAL、Block、Compaction 与 Retention"
sidebar_label: "04. TSDB、WAL 与 Block"
sidebar_position: 4
description: "从样本写入 Head、WAL 到持久化 Block 和 Compaction，解释本地 TSDB 的性能与恢复边界。"
tags: [Prometheus, TSDB, WAL, Block, Compaction, Retention]
---

# Prometheus TSDB、Head、WAL、Block、Compaction 与 Retention

Prometheus 本地存储是单节点 TSDB。它通过内存 Head 提供近期写入与查询，通过 WAL 支撑崩溃恢复，再周期性形成不可变 Block 并压缩。

## 1. 写入路径

```text
Scraped Samples
→ 校验Label Set与时间戳
→ 追加WAL
→ Head内存时序与Chunk
→ 形成持久Block
→ Compaction合并Block
→ Retention按时间/空间删除旧Block
```

一个 Block 包含 Chunk、Index、元数据和 Tombstone 等。查询会同时读取 Head 和相关 Block。Label Matcher 先通过索引缩小时序，再解码样本。

## 2. WAL 与启动恢复

进程异常退出后，Prometheus 重放 WAL 恢复尚未进入 Block 的 Head 数据。Active Series 多、WAL 大或磁盘慢时，启动会长期处于 Replay；这不是普通服务启动延迟，期间抓取和查询可用性会受影响。

不要在 Prometheus 运行时手工删 WAL/Block。损坏处理前复制数据目录并记录版本、错误和 ULID，优先按官方工具和备份恢复。

## 3. Retention 与容量

Retention 可受时间和空间约束。磁盘规划还要为 WAL、Head、Compaction 临时空间和文件系统余量留出空间。

```text
日样本数 = active_series × 86400 / scrape_interval
数据量 ≈ 日样本数 × 实测每样本字节 × 保留天数
```

“每样本字节”受 Label、Chunk 压缩和工作负载影响，必须从真实 TSDB 测量，不能使用固定常数作为最终容量。

## 4. Compaction 影响

Compaction 合并 Block、处理 Tombstone，消耗磁盘 I/O、CPU 和临时空间。查询风暴、远程写和 Compaction 同时发生时可能出现争用。SSD、足够 IOPS 和本地持久盘通常比网络共享文件系统更稳妥。

## 5. 排障

| 现象 | 检查 |
| --- | --- |
| 重启很慢 | WAL Replay、Active Series、磁盘延迟 |
| 查询近期有数据、历史缺失 | Block、Retention、时间范围 |
| 磁盘快速增长 | Series 基数、抓取间隔、新指标、WAL/Compaction |
| Compaction 失败 | 磁盘空间、权限、损坏 Block |
| OOM | Head Series、查询并发、高基数 |

## 6. 实验

记录 TSDB Status、Active Series 和数据目录大小；正常停止与强制终止各一次，比较启动日志和 WAL Replay 时间；缩短测试 Retention，观察 Block 生命周期。实验环境中备份后再模拟 Block 损坏，练习只读诊断。

参考：[Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/)。
