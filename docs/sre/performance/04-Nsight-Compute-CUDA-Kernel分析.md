---
title: "Nsight Compute CUDA Kernel 分析"
sidebar_label: "04. Nsight Compute CUDA Kernel 分析"
sidebar_position: 4
tags: [NVIDIA, Nsight Compute, CUDA, Kernel, Roofline, Occupancy]
description: "使用 Nsight Compute CLI 对目标 CUDA Kernel 进行 Roofline、Speed of Light、Occupancy、Memory Workload 和 Warp Stall 分析。"
---

# Nsight Compute CUDA Kernel 分析

Nsight Compute 回答：

> 一个已经确定的 CUDA Kernel 为什么没有达到目标性能？

它通过硬件性能计数器、Kernel Replay 和静态/动态信息分析：

- Compute Throughput。
- Memory Throughput。
- Roofline。
- Occupancy。
- Warp Scheduler。
- Stall Reasons。
- Cache/DRAM 访问。
- Launch Configuration。

不要用它分析整个在线服务的全部 Kernel。先通过 Nsight Systems 找到目标。

---

## 1. Systems 与 Compute 的分工

| 问题 | 工具 |
| --- | --- |
| GPU 为什么有 20ms 空洞 | Nsight Systems |
| 哪个 Kernel 占总时间最多 | Nsight Systems |
| Kernel 与 NCCL 是否重叠 | Nsight Systems |
| 目标 Kernel 是计算还是带宽受限 | Nsight Compute |
| Occupancy 为什么低 | Nsight Compute |
| Warp 在等待什么 | Nsight Compute |
| L1/L2/DRAM 行为如何 | Nsight Compute |

工作流：

```text
nsys → 锁定 Kernel 名、调用阶段、典型 Invocation
→ ncu 只采该 Kernel 的少量 Invocation
→ 修改
→ ncu 对比
→ 无 Profiler 端到端复测
```

---

## 2. Profiling 为什么会改变程序

Nsight Compute 可能为收集不同指标重复执行 Kernel：

```text
Application Replay
Kernel Replay
Range Replay
```

影响：

- Kernel 执行被序列化或重复。
- Cache 可能刷新。
- 在线请求超时。
- Collective 无法正常匹配。
- 非确定性 Kernel 的不同 Replay 结果变化。
- 报告采集时间很长。

因此：

- 使用隔离进程。
- 固定输入。
- 限制 Kernel/Invocation。
- 不用 Profile 下的端到端延迟作为生产结果。

---

## 3. 第一次采集

查看版本：

```bash
ncu --version
```

基础采集：

```bash
ncu \
  --set basic \
  --output kernel-baseline \
  <application> <args>
```

生成：

```text
kernel-baseline.ncu-rep
```

不要一开始使用 `--set full` 对全部 Kernel 采集。

---

## 4. 列出 Section 与 Set

```bash
ncu --list-sets
ncu --list-sections
```

常见分析 Section：

```text
SpeedOfLight
LaunchStats
Occupancy
MemoryWorkloadAnalysis
SchedulerStats
WarpStateStats
```

名称和可用指标可能随版本/GPU 改变，以上以当前 `--list-sections` 为准。

---

## 5. 过滤 Kernel

按名称：

```bash
ncu \
  --kernel-name regex:".*attention.*" \
  --launch-count 5 \
  --set basic \
  --output attention \
  <application> <args>
```

跳过前 N 个匹配：

```bash
ncu \
  --kernel-name regex:".*gemm.*" \
  --launch-skip 20 \
  --launch-count 3 \
  --output gemm-steady \
  <application> <args>
```

Kernel Name 可能是模板化、Mangled 或由 TorchInductor/Triton 生成。可通过：

- Nsight Systems Kernel Name。
- `--kernel-name-base`。
- 正则。
- Kernel ID/Context/Stream。
- NVTX Range。

精确选取。

---

## 6. 只采需要的 Section

```bash
ncu \
  --section SpeedOfLight \
  --section LaunchStats \
  --section Occupancy \
  --section MemoryWorkloadAnalysis \
  --kernel-name regex:".*target_kernel.*" \
  --launch-count 3 \
  --output target-analysis \
  <application> <args>
```

Section 越多，需要的 Replay Pass 可能越多。

先高层：

```text
SpeedOfLight + Roofline
```

再根据结果增加：

```text
Memory / Occupancy / Scheduler / WarpState
```

---

## 7. Speed of Light

SpeedOfLight 关注：

```text
Compute Throughput 相对峰值
Memory Throughput 相对峰值
Kernel Duration
```

四种粗略情况：

| Compute | Memory | 可能解释 |
| --- | --- | --- |
| 高 | 高 | 接近资源极限，优化困难 |
| 高 | 低 | 计算受限 |
| 低 | 高 | 内存/带宽受限 |
| 低 | 低 | 延迟、依赖、Occupancy、Launch 或负载太小 |

百分比接近峰值不等于应用最优；还需比较算法是否做了不必要工作。

---

## 8. Roofline 模型

定义：

```text
Arithmetic Intensity =
  Floating Point Operations / Bytes from target memory level
```

性能上界：

```text
Attainable Performance =
  min(
    Peak Compute,
    Arithmetic Intensity × Memory Bandwidth
  )
```

图上：

- 斜线区域：带宽限制。
- 水平区域：计算限制。
- 转折点：Ridge Point。

### 如何使用

Kernel 位于斜线下：

- 减少内存流量。
- 提高数据复用。
- Coalescing。
- 使用 Shared Memory/Cache。
- Fusion 避免中间张量回写。

Kernel 位于水平线下：

- 使用 Tensor Core。
- 提高指令效率。
- 合适 dtype。
- 减少控制流/无效计算。

Kernel 离任何 Roof 很远：

- Occupancy。
- Dependency。
- Divergence。
- Launch 太小。
- Latency。

Nsight Compute 可提供多层次 Roofline，例如 L1/L2/DRAM 层级。

---

## 9. Launch Configuration

关注：

```text
Grid Size
Block Size
Registers per Thread
Static/Dynamic Shared Memory
Waves per SM
```

问题：

- Grid 太小，无法填满 GPU。
- Block Size 不适合 Warp/资源。
- Register 太多，限制 Resident Warps。
- Shared Memory 太多，限制 Active Blocks。
- 尾部只有少量 Block，产生 Tail Effect。

不要机械追求最大 Block Size。

---

## 10. Occupancy

```text
Occupancy =
  Active Warps / Maximum Supported Active Warps
```

分为：

- Theoretical Occupancy：由 Launch 和资源上限推算。
- Achieved Occupancy：运行时实际达到。

限制因素：

- Registers。
- Shared Memory。
- Threads/Block。
- Blocks/SM。
- 架构上限。

### 高 Occupancy 不等于高性能

某些 Kernel：

- ILP 高。
- 每 Warp 做很多工作。
- 低 Occupancy 仍能隐藏延迟。

为了提高 Occupancy 而增加 Spilling，可能更慢。

优化必须看 Kernel Duration 和整体吞吐。

---

## 11. Warp Scheduler 与 Eligible Warps

每个周期 Warp Scheduler 需要找到可发射指令的 Eligible Warp。

如果：

```text
Active Warps 高
Eligible Warps 低
```

说明 Warp 大量等待：

- 数据依赖。
- Memory。
- Barrier。
- Pipeline。
- 分支。

这时仅提高 Occupancy 未必解决问题。

---

## 12. Warp Stall Reasons

常见方向：

```text
Long Scoreboard     → 等待较长延迟内存依赖
Short Scoreboard    → 等待较短依赖/Shared等
Barrier             → 同步
Not Selected        → 有 Eligible Warp 但未被选择
Wait                → 固定延迟执行依赖等
Math Pipe Throttle  → 数学管线压力
MIO Throttle        → Memory I/O 指令管线压力
Branch Resolving    → 控制流
```

名称和语义依架构/版本而变化，以报告 Rule 和 Profiling Guide 为准。

注意：

- Stall 样本是“没有发射时为什么”，不是直接的时间百分比。
- 某 Stall 高不代表单独改它就能等比例提速。
- 要与 Roofline、Memory、Source 和实验共同验证。

---

## 13. Memory Workload

分析层次：

```text
Registers
→ Local Memory
→ Shared Memory
→ L1/TEX
→ L2
→ Device Memory
```

关注：

- DRAM Throughput。
- L1/L2 Hit Rate。
- Load/Store Transactions。
- Requested Bytes 与 Transferred Bytes。
- Sectors per Request。
- Local Memory/Spill。
- Shared Memory Bank Conflict。

### Coalescing

同一 Warp 相邻线程访问连续地址，能减少 Memory Transaction。

访问离散：

```text
Thread 0 → addr 0
Thread 1 → addr 4096
Thread 2 → addr 8192
```

可能产生更多 Sector/Transaction。

### Cache Hit 不是越高越好

Streaming Workload 本来就可能低命中；强行提高 Cache 使用可能没有收益。最终看总字节、
带宽和 Duration。

---

## 14. Source/Instruction 分析

有 Line Info 时可关联源码：

- 哪一行产生热点指令。
- Memory Access。
- Stall。
- Register。

自定义 CUDA：

```text
-lineinfo
```

比完整 Debug `-G` 更适合性能分析；`-G` 会显著改变优化。

对于 Triton/Generated Kernel：

- 保存生成代码和编译配置。
- 记录 Shape、dtype、Tile/Warps。
- 使用 Kernel 名和 NVTX 映射回 Operator。

---

## 15. Attention Kernel 分析

可能受：

- Prompt/Context Length。
- Head Dim。
- KV dtype。
- GQA/MQA。
- Block/Table Indirection。
- KV Cache 访问。
- Batch/Sequence 数。

Prefill Attention 和 Decode Attention 资源模型不同，应分开采集。

### Prefill

- 更大矩阵。
- 计算和 Attention 复杂度高。
- 可能使用 Tensor Core。

### Decode

- 单步 Query 少。
- 读取长历史 KV。
- 更容易带宽/延迟受限。

不能用一个 Shape 的 Kernel 结果代表所有请求。

---

## 16. GEMM/MLP 分析

检查：

- Tensor Core 是否使用。
- dtype/Math Mode。
- Shape 对齐。
- Batch 是否太小。
- Epilogue Fusion。
- Memory Layout。

如果 Decode Batch 太小，即使 GEMM 实现优秀，也可能无法达到峰值。

优化方向可能在 Scheduler/Batch，而不是 Kernel 源码。

---

## 17. 通信 Kernel

NCCL Kernel 出现在时间线中，但 Collective 的端到端瓶颈还涉及：

- Rank 到达时间。
- NVLink/PCIe/RDMA。
- 拓扑。
- 其他 Rank。

Nsight Compute 对单个通信 Kernel 的分析不能替代 Nsight Systems 多 Rank 时间线和网络
计数器。

---

## 18. A/B 基线

为同一个 Invocation 保存：

```text
baseline.ncu-rep
candidate.ncu-rep
```

对比：

- Duration。
- Compute/Memory Throughput。
- Arithmetic Intensity。
- Occupancy。
- Register/Shared Memory。
- Memory Transaction。
- Warp Stall。

必须保持：

- 相同输入 Shape。
- 相同 Cache Control。
- 相同 Clock/Power。
- 相同 Kernel 版本。
- 相同 GPU。

最后用无 Profiler 工作负载确认端到端收益。

---

## 19. 常见错误

### `--set full` 采整个服务

Replay 时间巨大，甚至破坏在线通信和超时。

### 只追求 Occupancy

可能导致 Register Spill，性能反而下降。

### 只看 DRAM %

Kernel 可能受 L2、依赖、调度或指令限制。

### 用一个 Shape 代表全部请求

LLM Kernel 随 Batch、Context、Head、dtype 变化。

### 优化单 Kernel 但端到端没变化

它可能不在关键路径，或 Amdahl 上限很小。

### 比较不同采集配置

Replay/Cache Control/Section 不同，指标不可直接对比。

---

## 20. Amdahl 定律

如果目标 Kernel 占端到端 20%，即使加速 2 倍：

```text
speedup =
  1 / ((1 - 0.2) + 0.2 / 2)
  = 1 / 0.9
  ≈ 1.11
```

端到端理论提升约 11%。

因此先用 Nsight Systems确认 Kernel 在关键路径中的占比。

---

## 21. 实验

1. 用 Nsight Systems 找出总时间最高的计算 Kernel。
2. 用 `ncu --list-sections` 确认当前 Section。
3. 只采 1～3 个稳态 Invocation。
4. 先看 SpeedOfLight/Roofline。
5. 再选择 Occupancy 或 Memory 深入。
6. 记录 Replay Pass 和采集时长。
7. 修改一个 Launch/Tile/Fusion 参数。
8. 对比 Report。
9. 在无 ncu 环境运行完整压测。
10. 使用 Amdahl 定律解释端到端收益上限。

## 22. 验收清单

- [ ] 能从 Nsight Systems 选择目标 Kernel。
- [ ] 能限制 Kernel、Invocation 和 Section。
- [ ] 能解释 Replay 对程序的影响。
- [ ] 能读取 SpeedOfLight 和 Roofline。
- [ ] 能区分计算受限、带宽受限和低利用。
- [ ] 能解释 Theoretical/Achieved Occupancy。
- [ ] 能使用 Warp Stall 形成假设而非直接定论。
- [ ] 能分析 L1/L2/DRAM/Shared/Register。
- [ ] 能用 Amdahl 定律判断优化价值。
- [ ] 能用无 Profiler 压测验证最终收益。

## 23. 官方资料

- [Nsight Compute Documentation](https://docs.nvidia.com/nsight-compute/)
- [Nsight Compute CLI](https://docs.nvidia.com/nsight-compute/NsightComputeCli/)
- [Nsight Compute Profiling Guide](https://docs.nvidia.com/nsight-compute/ProfilingGuide/)

下一篇回到 PyTorch 框架层，使用 PyTorch Profiler 把 Python/Operator、CPU、CUDA Kernel
和 Tensor Memory 串起来。
