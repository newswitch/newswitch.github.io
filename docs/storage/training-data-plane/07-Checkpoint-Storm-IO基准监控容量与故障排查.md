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

参考：[PyTorch Distributed Checkpoint](https://docs.pytorch.org/docs/stable/distributed.checkpoint.html)、[IOR](https://github.com/hpc/ior)。
