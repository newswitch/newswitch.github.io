---
title: "内存、线程、网络、并发、容量规划与 Benchmark"
sidebar_label: "13. 内存、线程、网络、并发、容量规划与 Benchmark"
sidebar_position: 13
description: "按查询混合、写入、Merge、复制和故障恢复规划 ClickHouse 资源。"
tags: [ClickHouse, 容量规划, Benchmark, Memory]
---

# 内存、线程、网络、并发、容量规划与 Benchmark

## 1. 内存 {/* #内存 */}

查询聚合/Join/排序、并行线程、Mark/Uncompressed Cache、Merge、Mutation 和服务进程共享预算。`max_memory_usage` 是单查询保护之一，总并发仍可能 OOM；使用用户/资源组配额和全局 Overcommit/限流策略。

## 2. CPU/线程 {/* #cpu线程 */}

`max_threads` 提高单查询并行但减少集群可承载并发。后台 Merge/Fetch/Move 也用线程。容量目标是混合负载的可持续 P99，不是单查询最短时间。

## 3. 网络 {/* #网络 */}

分布式查询、复制、Distributed 写、备份和对象存储共享带宽。宽结果应在服务端聚合，避免 Initiator/客户端网络成为瓶颈。

## 4. 磁盘 {/* #磁盘 */}

```text
compressed active data × replicas
+ merge/mutation temporary
+ free watermark/recovery
+ detached/backup/cache
```

用真实压缩比、Part 大小和保留计算。

## 5. Benchmark {/* #benchmark */}

固定 Schema/ORDER BY、数据倾斜、查询 mix、并发和缓存状态；同时运行批量写、Merge、复制恢复。记录 query_log、ProfileEvents、P50/P99、read bytes、CPU/内存/磁盘/网络和错误。

## 6. 容量模型与基准矩阵 {/* #容量模型与基准矩阵 */}

```text
存储 = 日压缩数据 × 保留天数 × 副本 + merge/mutation临时空间
CPU = 峰值查询算子 + 写入压缩/merge + 副本发送与后台任务
内存 = 并发查询工作集 + mark/index/cache + 后台任务 + 安全余量
网络 = 写入 + 分布式查询shuffle/返回 + 副本复制 + 恢复流量
```

使用真实 Schema、数据排序、压缩、查询混合和并发，用 `clickhouse-benchmark` 或业务回放测 P50/P95/P99、吞吐、read rows/bytes、memory、CPU、磁盘和网络。矩阵覆盖稳态、峰值、单节点故障、冷缓存和后台 merge 高峰。

容量结论要给出版本、硬件、数据分布、参数和误差。达到目标吞吐但 P99/错误率超标不算通过；单查询最大性能也不代表多租户容量。扩容阈值应基于增长率和故障时剩余容量提前触发。

## 7. 验收题 {/* #验收题 */}

- 单查询 max memory 为何不能防总 OOM？
- 提高 max_threads 如何伤害并发？
- 分布式聚合应尽量在哪层先合并？
- 容量为何包含 Merge 临时空间？

## 8. 参考资料 {/* #参考资料 */}

- [Query complexity restrictions](https://clickhouse.com/docs/operations/settings/query-complexity)
- [ClickBench](https://benchmark.clickhouse.com/)
