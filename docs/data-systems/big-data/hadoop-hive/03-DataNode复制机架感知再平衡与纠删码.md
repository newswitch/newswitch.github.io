---
title: DataNode 复制、机架感知、再平衡与纠删码
sidebar_position: 3
tags: [HDFS, DataNode, 机架感知, Erasure Coding]
description: 掌握副本放置、故障域、Balancer、Disk Balancer 和纠删码的容量与恢复取舍。
---

# DataNode 复制、机架感知、再平衡与纠删码

DataNode 层的核心问题不是“有几份副本”，而是副本分布在哪些独立故障域、正常与恢复流量经过哪些链路、节点和卷是否均衡，以及冷数据是否值得用纠删码降低空间成本。

## 1. 副本与机架感知

NameNode依据网络拓扑选择副本位置，目标是在写入开销、读取本地性和机架故障容忍之间平衡。若所有节点都被错误配置到同一默认机架，三副本无法抵御机架交换机或电源故障。

上线前验证：

```bash
hdfs dfsadmin -printTopology
hdfs fsck /important/path -files -blocks -locations -racks
```

机架标签必须来自可靠 CMDB，并在迁移节点、换交换机时同步更新。

## 2. 心跳、Block Report 与重复制

DataNode 周期发送 heartbeat，NameNode据此判断活跃状态；Block Report 描述卷上的 Block。节点超时后，其 Block 副本数下降，NameNode调度其他 DataNode 从存活副本复制。

恢复速度受源盘读取、目标盘写入、机架网络和并发限制共同约束。把重复制并发调得过大，会让正常业务雪上加霜；过小又延长数据暴露窗口。需要为恢复预留容量和带宽。

## 3. Cluster Balancer 与 Disk Balancer

- **HDFS Balancer**在 DataNode 之间迁移 Block，让节点利用率接近目标。
- **Disk Balancer**处理同一 DataNode 内多个卷之间的不均衡。

二者不能替代业务分区和热点治理。容量均衡也不代表 I/O 均衡：热门文件副本可能集中在少数节点，慢盘节点即使容量不高也会造成长尾。

运行前必须确认：目标阈值、带宽上限、维护窗口、剩余空间和与 compaction/训练任务的冲突。记录移动字节、耗时、业务 P99 和失败 Block，而不是只看最终百分比。

## 4. Decommission 与 Maintenance

下线节点前，NameNode要确保其 Block 在其他节点达到目标冗余。直接关机可能同时触发大量 missing/under-replicated block。维护模式适合计划性短维护，decommission 适合永久移除，具体语义和命令随版本核对。

安全流程：冻结其他大变更 → 检查集群健康与空间 → 标记节点 → 观察复制/EC恢复 → 确认完成 → 下线 → 再次 `fsck` 抽查。

## 5. 纠删码的容量模型

EC 将数据拆为 `k` 个数据单元和 `m` 个校验单元，可容忍一定数量单元丢失。粗略存储放大：

```text
EC 放大 ≈ (k + m) / k
3副本放大 = 3
```

EC 空间效率更高，适合大、冷、顺序读取文件；代价是小写入与恢复更复杂，读取缺失单元时需要读取其他单元并解码，消耗 CPU、磁盘和跨机架网络。热点小文件和频繁追加数据通常不是理想起点。

## 6. EC 故障域与恢复

一个 stripe 的数据/校验单元应分散到足够多节点和机架。仅有数学上的 `m` 个校验块，不代表任意 `m` 个机架故障都能恢复，放置策略和同时故障相关性同样重要。

恢复时测量：

- degraded read 延迟和比例；
- reconstruction task 数、字节和失败；
- source/target 节点磁盘、CPU、网络；
- 重建期间正常 workload 的 P99；
- 恢复到健康冗余所需时间。

## 7. 实验矩阵

准备相同大文件，分别放入三副本目录和 EC policy 目录，记录物理占用、顺序读吞吐。停止一个 DataNode 后再次读取，对比 degraded read 和恢复流量。不要只比较容量节省。

```bash
hdfs ec -listPolicies
hdfs ec -getPolicy -path /warehouse/cold
hdfs dfsadmin -report
hdfs fsck /warehouse/cold -files -blocks -locations
```

## 8. 常见故障

| 现象 | 优先检查 | 典型原因 |
|---|---|---|
| under-replicated 长期不降 | 空间、复制队列、网络、坏盘 | 目标节点不足或限速过严 |
| 节点容量差异扩大 | balancer 状态、exclude、写入热点 | 新节点未均衡或策略约束 |
| 单节点卷差异大 | volume report、disk balancer | 新盘、坏盘、卷权重不均 |
| EC 读取长尾 | degraded read、重建、CPU/网络 | 单元丢失或慢盘 |
| 下线迟迟不完成 | decommission blocks、空间和机架 | 无合法放置目标 |

## 9. 掌握验收

- 用拓扑和 `fsck` 证明副本跨故障域；
- 区分 Cluster Balancer 与 Disk Balancer；
- 计算三副本和某 EC policy 的空间放大；
- 解释 EC degraded read 为什么放大网络和 CPU；
- 为节点下线写出可回滚、可观测的流程。

上一篇：[NameNode 元数据、Checkpoint、HA 与 Federation](./02-NameNode元数据Checkpoint-HA与Federation.md)　下一篇：[HDFS 容量规划、性能指标与故障排查](./04-HDFS容量规划性能指标与故障排查.md)

## 参考资料

- [HDFS Erasure Coding](https://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-hdfs/HDFSErasureCoding.html)
- [HDFS Balancer](https://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-hdfs/HDFSBalancer.html)
