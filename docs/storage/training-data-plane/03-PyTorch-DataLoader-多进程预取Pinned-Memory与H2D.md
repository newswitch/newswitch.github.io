---
title: "PyTorch DataLoader、多进程预取、Pinned Memory 与 H2D"
sidebar_label: "03. DataLoader 与 H2D"
sidebar_position: 3
description: "理解 DataLoader Worker、队列、内存复制、NUMA 与异步 H2D，定位 GPU 等待数据的问题。"
tags: [PyTorch, DataLoader, Pinned Memory, H2D, NUMA]
---

# PyTorch DataLoader、多进程预取、Pinned Memory 与 H2D

## 1. DataLoader 流水线

```text
Main Process生成Index
→ Index Queue
→ Worker读取/解码/Transform
→ Worker Result Queue
→ Pin Memory Thread
→ Main Process取得Batch
→ cudaMemcpyAsync H2D
→ GPU Stream消费
```

具体内部实现随 PyTorch 版本变化，但性能分析应围绕队列是否饥饿、Worker 是否阻塞、Batch 是否及时到达主进程。

## 2. 关键参数不是越大越好

| 参数 | 提升方向 | 代价/风险 |
| --- | --- | --- |
| `num_workers` | 并行 I/O 和 CPU 处理 | CPU 争用、内存和文件句柄 |
| `prefetch_factor` | 隐藏 I/O 抖动 | 预取 Batch 占用内存 |
| `persistent_workers` | 减少 Epoch 重建 | Dataset 更新和 Worker 状态 |
| `pin_memory` | 支持高效异步 H2D | 锁页内存压力 |
| `batch_size` | 提高 GPU 计算密度 | HBM、尾延迟和最后 Batch |

调参时一次改变一个因素，并记录 Data Wait 和 GPU Timeline。

## 3. 多进程内存

Linux `fork` 初始使用 Copy-on-Write，但父进程持有的大型 Python 对象被 Worker 访问或修改后可能复制。`spawn` 则需要 Pickle Dataset 和函数。Dataset 应避免在每个 Worker 复制巨大索引，可使用紧凑数组、内存映射或外部索引。

容器中的 `/dev/shm` 太小可能导致 Worker Bus Error；这不是 GPU 显存问题。

## 4. Worker Sharding

对于 IterableDataset，使用 Worker 信息和分布式 Rank 切分数据：

```text
global_worker_id = rank × workers_per_rank + worker_id
global_workers = world_size × workers_per_rank
```

然后按 `global_worker_id` 分配 Shard。否则多个 Rank/Worker 可能读取完全相同数据。

## 5. Pinned Memory 与异步 H2D

Pinned Memory 不能被 OS 换出，DMA 可以直接访问。要实现重叠：

- 源 Tensor 位于 Pinned Memory；
- 使用非阻塞 Copy；
- Copy 与计算放在可并行 Stream；
- Buffer 生命周期覆盖异步操作；
- GPU 后续计算建立正确依赖。

只设置 `pin_memory=True` 不等于 H2D 已与计算重叠，应在 Nsight Systems 或 PyTorch Profiler 中验证。

## 6. NUMA

Worker CPU、内存分配、NIC/NVMe 和 GPU 应尽量位于相同 NUMA 域。跨 Socket 读取会消耗互连并增加 H2D 延迟。Slurm/Kubernetes CPU Pinning 后，还要确认 DataLoader Worker 继承的 CPUSet 是否覆盖足够本地 Core。

## 7. 故障定位

| 现象 | 检查 |
| --- | --- |
| GPU 周期性空洞 | Result Queue、远端 P99、GC、Checkpoint |
| Worker 退出 | stderr、`/dev/shm`、OOM、文件损坏 |
| Worker 越多越慢 | CPU/内存带宽、锁、存储并发、线程过量 |
| H2D 很慢 | Pinned、NUMA、PCIe、Batch碎片 |
| 每个 Epoch 停顿 | Worker 重建、Shuffle、缓存失效 |

## 8. 预取的内存预算

设 Rank 数为 R，每 Rank 有 W 个 Worker，每 Worker 预取 F 个 Batch，每 Batch 展开后约 B 字节。可用 `R × W × F × B` 估算这部分在途 Batch 的容量级别，而不是整个进程组 RSS 的精确公式；解码临时对象、主进程当前 Batch、锁页副本和缓存还会增加占用。

教学条件 R=8、W=4、F=2、B=256 MiB，预取部分约为 16 GiB。把 W 从 4 提高到 16 后，该项就约为 64 GiB，尚未计算其他内存。这解释了为什么增大 Worker 后可能在主机内存或 `/dev/shm` 失败，而不是更快喂满 GPU。

## 9. 串行时间与流水线周期

假设准备一个 Batch 需 60 ms、H2D 需 10 ms、计算需 80 ms。完全串行约为 150 ms；若三阶段能在不同 Batch 间充分重叠，稳态周期的理想下界由最慢阶段决定，约为 80 ms。首个 Batch 和流水线排空仍有额外时间。

若准备时间偶尔达到 200 ms，预取队列可以吸收部分抖动，但不能弥补长期平均生产速度不足。判断方向应观察队列是否持续被耗尽与 GPU 时间线，而不是只比较一次平均文件读速。

## 10. 异步操作的正确性

异步 H2D 返回时数据可能仍在传输。源内存不得提前修改或复用，目标 Tensor 被计算使用前需要正确流依赖。使用独立 Copy Stream 后，还应处理跨流同步和内存生命周期，不能只把 `non_blocking=True` 当作完成证明。

CPU 解码是瓶颈时，GDS 不会自动替应用完成图片解码或 Tokenization；页缓存命中也不代表数据已经在 HBM。优化必须找到关键路径中的实际慢阶段，见[数据完整路径](./01-训练数据从对象存储到GPU的一次完整路径.md)。

## 11. 掌握检查

为什么 Worker 翻倍不一定吞吐翻倍？共享 CPU、存储、内存带宽与锁会限制扩展。为什么 Copy 更快而 Step 不变？Copy 可能早已被计算隐藏，或者瓶颈在准备和尾部 Rank。

参考：[PyTorch DataLoader](https://docs.pytorch.org/docs/stable/data.html)、[PyTorch Performance Tuning Guide](https://docs.pytorch.org/tutorials/recipes/recipes/tuning_guide.html)。
