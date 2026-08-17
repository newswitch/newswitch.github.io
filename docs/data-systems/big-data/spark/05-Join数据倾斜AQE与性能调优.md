---
title: Spark Join、数据倾斜、AQE 与性能调优
sidebar_label: "05. Spark Join、数据倾斜、AQE 与性能调优"
sidebar_position: 5
tags: [Spark, Join, 数据倾斜, AQE]
description: 从物理计划和 task 分布识别 Join 倾斜，正确使用广播、AQE、salting 和两阶段聚合。
---

# Spark Join、数据倾斜、AQE 与性能调优

Spark 调优不是背参数，而是按“物理计划 → Stage → Task 分布 → 节点资源 → 正确性”寻找瓶颈。Join 是 Shuffle、内存和倾斜最集中的场景。

## 1. 先量化倾斜

比较每 task input、Shuffle read、duration、spill 的 P50/P95/max，并查询 key Top-N、NULL 比例和 Join 放大：

```text
skew_ratio = max_partition_bytes / median_partition_bytes
join_amplification = output_rows / max(left_rows, right_rows)
```

任务慢也可能是节点慢：若同节点多个不同 partition 都慢，先查磁盘、网络、GC 和 throttling。

## 2. Join 选择

- 小表广播：省去大表 Shuffle，但每个 executor 构建副本，需看实际大小与并发；
- Sort Merge：两大表按 key Shuffle/排序，稳定但 I/O 大；
- 共分区/桶布局：满足条件时减少交换，需证明计划利用；
- 非等值 Join：可能退化为昂贵策略，应限制候选范围。

先过滤和列裁剪，再 Join；避免 Join 后才丢弃 90% 数据。

## 3. 热 Key 治理

### Salting

大表热 key 随机加盐，小表对应 key 复制 N 份；Join 后去盐。适合小侧可复制，代价是额外行和逻辑复杂。

### 分流

提前识别热点，普通 key 走常规 Join，热点单独策略后 union。适合热点集合稳定。

### 两阶段聚合

对可结合聚合先按 `(key,salt)` 局部聚合，再按 key 合并，降低最大 partition。

### 业务修正

NULL/unknown 共用一个 key 常是模型问题；按正确业务粒度拆分比永久参数补丁更可靠。

## 4. AQE

Adaptive Query Execution 可根据运行期统计合并小 Shuffle partition、调整 Join 策略和处理部分倾斜。检查最终 adaptive plan 和具体优化节点，不能只确认开关。AQE 也无法修复语义上的多对多爆炸、外部 UDF 慢和数据模型错误。

## 5. 系统化顺序

1. 固定输入 snapshot、代码和资源，保存基线；
2. 用 plan 去掉全扫描、不必要列和重复 Exchange；
3. 用 task 分布识别倾斜/长尾；
4. 检查 CPU、GC、spill、磁盘、网络和 sink；
5. 一次改变一个变量；
6. 比较 P50/P95/max 和成本；
7. 用 count、sum、checksum 验证结果。

## 6. 常见反模式

- 无证据把 Shuffle partition 调成 executor core 数；
- 看到 OOM 就无限加内存；
- 强制广播随数据增长最终爆炸；
- 所有表 cache；
- 只优化总耗时，不看输出小文件和资源成本；
- 用 speculation 掩盖确定性热 key。

## 7. 实验

构造一个 key 占 40% 的事实表和小维表。比较 sort-merge、broadcast、AQE、salting。记录 final plan、Shuffle bytes、max/median task、spill、总耗时、输出 checksum。再把维表放大，验证广播何时成为风险。

## 8. 掌握验收

- 用 task 分位数和 key 统计证明倾斜；
- 为广播估算 executor 内存和网络放大；
- 解释 AQE 做了什么及不能做什么；
- 在 salting、分流、两阶段聚合中选型；
- 优化后同时验证正确性和资源成本。

上一篇：[Shuffle、内存与 Spill](./04-Shuffle内存缓存Spill与序列化.md)　下一篇：[Structured Streaming 状态与 Checkpoint](./06-Structured-Streaming状态Watermark与Checkpoint.md)

## 参考资料

- [Spark SQL Performance Tuning](https://spark.apache.org/docs/latest/sql-performance-tuning.html)
