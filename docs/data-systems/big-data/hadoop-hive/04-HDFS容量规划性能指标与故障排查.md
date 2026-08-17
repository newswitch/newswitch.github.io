---
title: HDFS 容量规划、性能指标与故障排查
sidebar_label: "04. HDFS 容量规划、性能指标与故障排查"
sidebar_position: 4
tags: [HDFS, 容量规划, 性能, 故障排查]
description: 建立 HDFS 容量、吞吐、安全水位和恢复模型，并用分层证据排查读写慢、坏块与空间异常。
---

# HDFS 容量规划、性能指标与故障排查

HDFS 能启动不代表可承载生产。容量规划必须包含副本/EC、增长、临时文件、snapshot、恢复和均衡空间；性能排查必须从客户端一路下钻到 NameNode RPC、DataNode、磁盘和网络。

## 1. 容量公式

```text
逻辑数据 = 日增量 × 在线保留天数
物理数据 = 各目录逻辑数据 × 对应副本或 EC 放大
规划容量 = (物理数据 + snapshot旧块 + 临时/中间数据 + 恢复余量) / 目标使用率
```

不要把所有目录统一乘 3：热数据可能三副本，冷数据可能 EC。Snapshot 创建时几乎不复制数据，但后续删除/改写的旧 Block 因引用仍占空间。Spark Shuffle 通常在本地盘，不一定进入 HDFS，也要单独规划节点临时盘。

容量水位至少分为告警、限制新大任务、启动清理/扩容和紧急只读处置。集群过满时，副本重建和 balancer 无目标空间，可靠性会快速恶化。

## 2. 吞吐估算

```text
所需写带宽 ≈ 入口逻辑带宽 × 冗余写放大 + 恢复/均衡流量
可用读带宽 ≤ min(DataNode磁盘总吞吐, 网络, 客户端处理能力)
```

峰值不仅来自业务入口，还包括补数、DistCp、compaction、训练扫描和副本恢复。容量测试要覆盖正常、单节点故障和多 workload 争抢三种场景。

## 3. 指标分层

### NameNode

files/blocks、heap/GC、RPC queue/processing time、safe mode、missing/corrupt/under-replicated block、checkpoint age。

### DataNode

容量与卷差异、读写 bytes/ops/latency、xceiver 数、volume failure、block verification、网络和磁盘 await/queue。

### 客户端/作业

open/create 延迟、local/remote read、失败重试、每 task input bytes、P50/P95/max task duration。集群平均吞吐会掩盖某个慢 DataNode。

## 4. 标准排障顺序

1. **定义范围**：单文件、单租户、单节点还是全局；开始时间和变更是什么。
2. **验证健康**：NameNode 状态、safe mode、dead node、missing block、容量水位。
3. **分离元数据与数据延迟**：`ls/open` 慢偏控制面，持续读写慢偏数据面。
4. **定位 Block 与节点**：用 `fsck -locations` 找到副本，比较不同副本读取。
5. **检查主机**：磁盘 SMART/await、CPU/GC、网络重传、连接数、日志。
6. **检查争抢**：重复制、balancer、DistCp、Spark、训练是否同时发生。
7. **修复后校验**：吞吐/延迟恢复，并验证 checksum、Block 与副本健康。

## 5. 典型场景

### `No space left` 但报表显示有空间

检查单个 DataNode/volume 是否满、reserved space、目录 quota、写入放置约束和非 HDFS 文件占用。总容量有余量不代表每个写 pipeline 都能找到合法目标。

### 小文件导致 NameNode 压力

表现为文件数增长远快于字节、RPC queue 和 heap 上升、list/open 慢。治理在 writer 端合并文件、提高 rolling size、批量 compaction 和设置 quota；扩大 NameNode heap 只是争取时间。

### 单个文件读慢

查看 Block 副本位置，尝试其他副本；对比对应 DataNode 磁盘和网络。若只有某个副本慢，应隔离慢盘/节点，而不是全局扩容。

### 大量 under-replicated

确认是否节点故障或机架断链，检查合法目标空间和复制队列。限制恢复流量要兼顾业务 P99 与数据暴露时间。

## 6. 基准方法

使用代表性文件大小和并发度分别测试顺序写、顺序读、小文件 create/list，以及节点故障后的恢复。工具结果必须标注是否命中 OS cache、客户端节点位置、副本/EC policy 和同时运行的任务。

不要在繁忙生产集群直接运行无上限压力工具。先在隔离环境确定命令和预计字节，生产只执行有配额、可停止的验证。

## 7. Runbook 最小模板

```text
告警与SLO -> 影响范围 -> 只读检查命令 -> 判定树
-> 可逆缓解 -> 升级条件 -> 数据校验 -> 恢复观察 -> 复盘项
```

重大修复前记录 NameNode 状态、坏块清单和配置；不要为了让告警消失直接删除坏文件或降副本数。

## 8. 掌握验收

- 把副本、EC、snapshot、临时数据和恢复余量纳入容量；
- 区分 NameNode 元数据慢与 DataNode 数据慢；
- 从慢文件定位 Block、副本、节点和物理盘；
- 解释集群空间未满却无法创建 pipeline 的原因；
- 为恢复流量设计带宽上限和完成时间 SLO。

上一篇：[DataNode 复制、机架感知、再平衡与纠删码](./03-DataNode复制机架感知再平衡与纠删码.md)　下一篇：[YARN 资源模型与调度路径](./05-YARN资源模型与调度路径.md)

## 参考资料

- [HDFS Commands Guide](https://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-hdfs/HDFSCommands.html)
- [HDFS Metrics](https://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-common/Metrics.html)
