---
title: 综合项目：Spark ETL 数据倾斜与性能优化
sidebar_label: "04. 综合项目：Spark ETL 数据倾斜与性能优化"
sidebar_position: 4
tags: [Spark, ETL, 数据倾斜, 性能优化, 项目]
description: 用可重复基准从物理计划、Task 长尾、Shuffle、Spill 和文件布局完成一次性能优化闭环。
---

# 综合项目：Spark ETL 数据倾斜与性能优化

本项目不追求某个漂亮耗时，而是练习证据驱动调优：构造真实分布，保存 baseline，定位慢 stage/partition，依次应用下推、广播、AQE、salting和文件治理，并证明结果不变、成本可接受。

## 1. Workload

事实表 `events` 5 亿行：`tenant_id,user_id,event_type,event_time,value,payload`。租户 A 占 45%，`user_id=0`（匿名）占 20%；payload宽且查询不用。维表 `users` 500 万行。目标按 tenant/day聚合并关联用户等级。

准备固定 Iceberg snapshot和 checksum；运行环境固定 Spark镜像、executor、节点和并发。冷/热缓存分开。

## 2. Baseline

保存：formatted/final physical plan、event log、各 stage/task分位数、scan bytes/files、Shuffle、spill、GC、executor/节点、输出 files和 count/sum/checksum。

先回答：时间花在 planning、scan、Shuffle、Join、aggregation还是write；长尾是数据还是节点。

## 3. 假设 A：减少扫描

将 filter/列裁剪前推，避免读取 payload；检查 partition/file/Parquet下推。用 physical input bytes而非总耗时证明。若 UDF阻止下推，改内置表达式并比较。

## 4. 假设 B：Join 策略

更新 statistics，观察 CBO/AQE；评估维表序列化/构建后大小。Broadcast时记录每 executor内存、网络和GC；不适合时保留 sort-merge。禁止仅凭源文件大小强制 hint。

## 5. 假设 C：倾斜

统计 key Top-N、NULL和 partition bytes；比较 max/median task。分别测试：

1. 只增加 Shuffle partitions；
2. AQE skew handling；
3. 匿名 user用 event/session更细粒度（若语义允许）；
4. tenant A/hot key分流；
5. `(key,salt)`两阶段聚合。

预期只加 partition不能拆一个热 key。每种方案验证业务粒度未改变。

## 6. 假设 D：内存与 Spill

查看大 partition、peak execution memory、memory/disk spill、GC。调 executor memory/overhead/cores和 partition大小时，保持总资源可比。更大 executor可能降低并发并增加GC，不能只看单task。

## 7. 假设 E：输出

过高 writer并行度导致数万小文件；过低导致单task长尾。按目标文件大小和分区数据量计算 writer，使用 AQE/coalesce/repartition并观察最终 file P10/P50/P90、commit/planning。

## 8. 实验表

| Run | 唯一变更 | 总/P95/max task | Scan | Shuffle | Spill | CPUh | 文件数 | 校验 |
|---|---|---|---|---|---|---|---|---|
| B0 | baseline |  |  |  |  |  |  |  |
| R1 | 列/谓词下推 |  |  |  |  |  |  |  |
| R2 | Join |  |  |  |  |  |  |  |
| R3 | AQE |  |  |  |  |  |  |  |
| R4 | Salting |  |  |  |  |  |  |  |
| R5 | 输出文件 |  |  |  |  |  |  |  |

不要一次改多项，否则无法归因。重复运行取分布并标记环境噪声。

## 9. 故障与回归

优化版本中杀 executor，确认 stage重算和输出幂等；让一个节点慢，验证 speculation/隔离；让维表增长超过广播安全线，确认计划回归告警；改变数据分布，观察 salting热点检测是否仍有效。

## 10. 成功标准

同时满足：deadline、P95/max task下降、CPUh/内存/网络不过度上升、输出文件健康、结果完全一致、故障可恢复。总耗时快但资源翻十倍不算生产优化。

## 11. 交付物

Baseline与最终 plan/event log、每次实验表、倾斜 key分布、资源/文件/正确性证据、计划回归阈值、运行手册和回滚配置。

## 12. 验收

- 5分钟内从 UI找慢 stage和最大 task；
- 证明瓶颈是热 key还是慢节点；
- 解释 AQE/广播/salting的实际变化；
- 优化后 checksum和业务守恒不变；
- 数据增长/分布变化时能自动发现回归。

上一篇：[实时湖仓项目](./03-Kafka-Flink-Iceberg实时湖仓项目.md)　下一篇：[GPU 训练数据集生产项目](./05-面向GPU训练的数据集生产版本化与吞吐优化项目.md)
