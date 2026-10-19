---
title: "Checkpoint Storm、I/O 基准、监控、容量与故障排查"
sidebar_label: "07. Checkpoint 与 I/O 排障"
sidebar_position: 7
description: "建立分布式 Checkpoint 的带宽和一致性模型，控制同时写入风暴，并用分层基准定位训练 I/O 瓶颈。"
tags: [Checkpoint, I/O, 容量规划, fio, IOR, 故障排查]
---

# Checkpoint Storm、I/O 基准、监控、容量与故障排查

## 1. Checkpoint 容量模型

设单次 Checkpoint 总量为 `S`，期望在 `T` 秒内完成，则最低有效聚合带宽：

```text
BW_required = S / T
```

实际还要考虑元数据、临时文件、校验、复制/纠删码、网络竞争和尾部 Rank，因此规划带宽需要余量。保留空间还包括多个版本、保存中的临时版本和垃圾回收窗口。

## 2. Storm 如何产生

如果大量训练按固定间隔或整点保存，它们会同时写共享存储：

```text
多个任务同频Checkpoint
→ 网卡和Metadata突发
→ 写延迟上升
→ 所有Rank等待
→ 下一轮保存继续重叠
```

使用随机抖动、全局并发限制、按任务优先级调度保存、本地暂存后异步上传，以及错开大作业窗口。

## 3. 一致性

一个可靠版本应包含 Manifest、Shard 列表、大小/Checksum、训练 Step、World Size、框架与模型版本和完成标志。发布顺序：先数据、再元数据、最后原子更新完成标志或 `latest` 指针。

对象存储可用不可变对象加条件写更新指针；POSIX 文件系统可用同文件系统 Rename。不要把跨文件系统 Move 当成原子操作。

## 4. 基准工具分层

| 工具/负载 | 证明什么 |
| --- | --- |
| `fio` | 块/文件 I/O 延迟、IOPS、带宽基线 |
| IOR | 多客户端大文件/共享文件并行吞吐 |
| mdtest | Create/Stat/Remove 等元数据能力 |
| 对象存储客户端 | GET/Range/PUT/Multipart 与限流 |
| Dataset Replay | 真实 Shard、Decode 和 Worker 行为 |
| Checkpoint Replay | 真实 Rank、文件数、同步和发布 |

基准参数必须匹配真实 Block Size、并发、文件数、读写比例、Direct/Page Cache 和 Network Path。

## 5. 可观测性

从训练进程、客户端、节点、网络、服务和介质六层采集：

- Data Wait、Checkpoint Duration 和每 Rank Bytes；
- Open/Read/Write/fsync 延迟与错误；
- Cache Hit/Miss、Dirty Page、Writeback；
- NIC/RDMA Throughput、Retransmit、Congestion；
- Metadata/Data Target 队列和延迟；
- Disk Queue、Util、Latency、SMART。

## 6. 故障树

```text
所有Rank同时慢 → 共享服务/网络/Checkpoint同步
单Rank持续慢 → 节点NVMe/NIC/NUMA/Shard倾斜
首个Epoch慢后续快 → 冷缓存或编译/预处理
小文件慢大文件正常 → Metadata瓶颈
吞吐高但Step仍慢 → 尾延迟、同步或CPU处理
保存成功但恢复失败 → Manifest/Shard/版本一致性
```

## 7. 恢复演练

定期验证中断写入、丢失一个 Shard、对象返回旧版本、World Size 改变和存储短时不可用。恢复时间和数据损失窗口必须通过实际加载证明，不能只确认备份目录存在。

## 8. 从逻辑字节到后端负载

教学条件：一个 Checkpoint 逻辑总量为 480 GiB，希望 120 秒内保存，最低有效聚合写入为 4 GiB/s。若后端采用三副本且所有副本都在测量窗口内写入，忽略协议、元数据和校验等开销，后端介质写入量就约为 1440 GiB，对应约 12 GiB/s。

逻辑写带宽、客户端网络带宽和介质写带宽因此不是同一个指标。纠删码、压缩、缓存、异步复制和完成语义会改变放大关系，不能把这个三副本教学系数用于所有存储。

## 9. 尾部 Rank 决定同步完成

若每个 Rank 保存一份 Shard，发布完整版本需要等待所有必要分片。总平均带宽充足时，一个拥塞客户端、一个大 Shard 或一个慢 Metadata 操作都可能延长整体等待。应比较每 Rank 字节、开始完成时间、错误重试和数据分布。

真实应用评估至少保留保存时长、后台上传积压、训练 Step 抖动、存储尾延迟和恢复时间。异步保存把等待转成缓冲与后台工作，不会消除字节与可靠性成本；后台赶不上生产速度时，队列会不断增长。

## 10. 可见性与持久化

同文件系统 Rename 可以用于原子发布名字，但持久性仍依赖文件与目录同步及文件系统契约。对象存储使用不可变分片和最后发布的 Manifest 时，应校验完整分片集合、版本与校验值，不把“所有 PUT 请求都已发出”当作版本完成。

故障演练可在纸面切断“最后分片前”“Manifest 前”“latest 更新前”三个位置，推导恢复端应选择哪个完整版本。没有硬件时可以验证协议不变量，但不能把纸面推演当成存储掉电持久性实测。

## 11. 掌握检查

为什么保存返回成功仍应演练恢复？需要确认版本发现、元数据、框架和 World Size 兼容。为什么 fio 峰值达标仍会训练抖动？基准可能没有复现真实元数据、同步和突发竞争。

参考：[PyTorch Distributed Checkpoint](https://docs.pytorch.org/docs/stable/distributed.checkpoint.html)、[IOR](https://github.com/hpc/ior)。
