---
title: "CUDA 执行模型与 Kernel 性能基础"
sidebar_label: "01. CUDA 执行模型与 Kernel 性能基础"
sidebar_position: 1
description: "从 Grid、Block、Thread、Warp、SM 和内存层次理解 CUDA Kernel 的执行、同步、分支、访存与性能分析。"
tags: [CUDA, Kernel, Thread, Warp, Occupancy, Memory Coalescing, GPU]
---

# CUDA 执行模型与 Kernel 性能基础

深度学习框架把算子最终交给 CUDA Kernel。即使不手写 CUDA，也需要理解：为什么一个 shape 改变会掉速、为什么 GPU 利用率高但吞吐低、为什么显存带宽和 occupancy 不能单独代表性能。

## 1. 从软件层到硬件

```text
PyTorch/vLLM/算子库
→ CUDA Runtime / Driver
→ Kernel launch + CUDA Stream
→ Grid
  → Thread Blocks
    → Warps (32 threads)
      → SM warp schedulers
        → CUDA/Tensor Core、Load/Store、Special Function
→ Register / Shared Memory / L1 / L2 / HBM
```

CUDA 编程模型提供逻辑抽象；具体 SM 数量、调度器、寄存器、缓存和指令吞吐随 GPU 架构变化，必须查目标 compute capability 文档。

## 2. 最小 Kernel

```cpp
__global__ void vector_add(const float* a,
                           const float* b,
                           float* c,
                           int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        c[i] = a[i] + b[i];
    }
}

int threads = 256;
int blocks = (n + threads - 1) / threads;
vector_add<<<blocks, threads, 0, stream>>>(a, b, c, n);
```

启动配置 `<<<gridDim, blockDim, sharedMemBytes, stream>>>` 决定：

- 创建多少 Block；
- 每个 Block 多少 Thread；
- 动态 Shared Memory；
- 放入哪个 Stream。

Kernel launch 通常对 Host 异步。launch 返回不代表 GPU 已完成；错误也可能在后续同步时暴露。

## 3. Grid、Block 与 Thread

### 3.1 Thread {/* #thread */}

执行同一 Kernel 程序的逻辑实例，有自己的 thread index、寄存器状态和局部控制流。

### 3.2 Block {/* #block */}

一组线程：

- 调度到同一个 SM；
- 可以通过 Shared Memory 通信；
- 可以使用 block 级同步；
- 不应依赖不同 Block 的执行顺序。

### 3.3 Grid {/* #grid */}

一次 Kernel launch 的全部 Block。Block 可以按任意顺序并行或串行执行，这是可扩展性的基础。

二维/三维 grid/block 适合矩阵、图像等索引，但最终仍线性映射到硬件线程/warp。

## 4. Warp 与 SIMT

一个 Warp 包含 32 个线程。SIMT 表示线程执行同一 Kernel，但每个线程有独立数据和控制流。

```text
warp lanes: 0 1 2 ... 31
instruction: load a[i]
```

Warp 是理解分支和合并访存的核心。Block 线程数不是 32 倍数时，最后一个 warp 有永远不活跃的 lane，通常降低效率。

## 5. 分支发散

```cpp
if (threadIdx.x % 2 == 0) {
    path_a();
} else {
    path_b();
}
```

同一 warp 中一半线程走 A、一半走 B，硬件需要执行两条路径并屏蔽不参与 lane，降低有效利用。若条件按 warp 划分：

```cpp
if ((threadIdx.x / 32) % 2 == 0) ...
```

每个 warp 内控制流一致，发散减少。

边界 `if (i < n)` 通常只影响最后一个 warp，代价有限。不要为了消除所有分支写更复杂且增加访存的代码；用 profiler 证明。

## 6. SM 如何容纳 Block

一个 SM 可同时驻留多个 Block/warp，受以下资源最先耗尽者限制：

- 每 SM 最大 threads/warps/blocks；
- 每 Block threads；
- 每线程寄存器；
- 每 Block Shared Memory；
- 架构限制。

```text
active warps
occupancy = --------------------------
            maximum supported warps
```

Occupancy 反映可用于隐藏延迟的并发 warp 比例，不直接等于运算单元利用率或性能。

## 7. Occupancy 的正确理解

高 occupancy 有助于当某 warp 等 HBM/指令依赖时调度其他 warp，但：

- 计算密集 Kernel 可能在中等 occupancy 已达峰；
- 为提高 occupancy 限制寄存器可能产生 register spilling；
- 更小 Block 未必提高整体并行；
- Shared Memory tiling 可降低 occupancy，却显著减少 HBM 流量；
- 过多 warp 可能增加缓存压力。

优化目标是吞吐/延迟，不是 100% occupancy。

## 8. 寄存器与 spilling

每线程频繁使用的标量/临时值通常放寄存器。寄存器非常快，但 SM 总量有限：

```text
registers per thread ↑
→ active threads/blocks per SM 可能 ↓
```

寄存器不足时，编译器可能 spill 到 local memory。CUDA 的 local memory 是线程私有地址空间，但物理上通常位于 device memory/cache 层次，不是片上低延迟内存。

观察编译资源：

```bash
nvcc -Xptxas=-v <source.cu> -o <binary>
```

具体输出和优化随编译器版本/目标架构变化。

## 9. Shared Memory

Shared Memory 位于 SM，Block 内线程共享，常用于：

- tile 数据复用；
- 数据重排；
- reduction；
- 避免重复 HBM 访问。

代价：

- 占用限制驻留 Block；
- bank conflict；
- 需要同步；
- tile 边界与复杂度。

### 9.1 Bank conflict {/* #bank-conflict */}

同一 warp 对 Shared Memory 的地址映射到同一 bank 且不是可广播模式时，访问可能序列化。bank 数和规则随架构，使用 Nsight Compute 指标验证。

## 10. 全局内存与合并访问

相邻 warp lane 访问相邻、对齐地址时，硬件可合并为较少内存事务：

```cpp
// coalesced direction
x[base + threadIdx.x]

// strided direction
x[base + threadIdx.x * stride]
```

后者可能请求大量内存 segment，只使用少量字节，实际 HBM 流量远大于有效数据。

有效带宽：

```text
effective BW = application useful bytes / kernel time
```

与 profiler 的实际 device memory throughput 对比，可以估算无效传输。不同架构事务粒度和缓存行为不同，不能死记旧规则。

## 11. 内存层次

```text
Registers          最接近线程，容量有限
Shared Memory/L1   SM 内，Block 共享/缓存
L2                 全 GPU 共享
HBM/Global Memory  容量大、带宽高但延迟高
Host Memory        经 PCIe/NVLink-C2C 等，通常更远
```

性能取决于数据复用和流量在哪一层命中。HBM 带宽很高，但仍远低于寄存器/Shared Memory 的片上供数能力。

## 12. 同步

### 12.1 Block 内 {/* #block-内 */}

`__syncthreads()` 等同步确保 Block 内线程到达并满足相关内存可见性。若同步位于只有部分线程到达的发散路径，可能死锁或未定义行为。

### 12.2 Stream 内 {/* #stream-内 */}

同一 Stream 的操作按 CUDA 规定排序。不同 Stream 可并发，但受依赖、硬件引擎和资源限制。

### 12.3 Host 与 Device {/* #host-与-device */}

`cudaDeviceSynchronize()` 等等待 GPU，频繁全局同步会破坏 pipeline。正确做法是用 event/stream dependency 表达必要顺序，而不是每个 Kernel 后同步。

### 12.4 多 GPU {/* #多-gpu */}

NCCL Collective 和 peer copy 引入设备间同步；一个慢 rank 会让其他 rank 等待。

## 13. CUDA Stream 与并发

Stream 可重叠：

- H2D/D2H copy；
- 多个 Kernel；
- compute 与 communication；
- 不同请求/批次。

前提：

- 操作没有依赖；
- 设备支持相应并发；
- 使用 pinned host memory 等条件；
- Kernel 没占满全部资源；
- 没有隐式同步。

框架中默认 stream、allocator、Python/CPU 调度也会影响并发。

## 14. Kernel launch overhead 与小 Kernel

大量微小 Kernel 可能让 GPU 时间线出现空隙：

```text
Host launch → short kernel → Host launch → short kernel ...
```

改善方向：

- 算子融合；
- CUDA Graph；
- 增大 batch；
- 减少 Python/CPU 调度；
- 异步 pipeline。

融合会增加寄存器、编译时间和复杂度，需 profiler A/B。

## 15. Tensor Core 的条件

Tensor Core 加速矩阵乘加，但达到高吞吐需要：

- 支持的数据类型与架构；
- 合适 shape/对齐；
- 使用 cuBLAS/cuDNN/Triton/框架高效 Kernel；
- 数据布局与访存；
- 足够计算规模；
- 精度策略满足业务。

GPU 有 Tensor Core 不等于任何 FP16/BF16 Kernel 自动使用它。

## 16. 性能瓶颈分类

| 类别 | 迹象 | 优化方向 |
|---|---|---|
| 计算吞吐 | 算力管线接近上限 | shape、Tensor Core、指令、算法 |
| HBM 带宽 | DRAM throughput 高、低算术强度 | 复用、融合、压缩/精度 |
| 延迟/依赖 | pipeline stall，低并行 | 增加独立工作、减少依赖 |
| Occupancy/资源 | 寄存器/Shared 限制 active warps | block/resource 权衡 |
| 访存效率 | 实际流量远大于有效字节 | coalescing、布局、tile |
| 发散 | branch efficiency 低 | 数据/任务重排 |
| launch/CPU | Kernel 间空洞 | 图捕获、融合、CPU 优化 |
| 通信 | NCCL/peer 时间长 | 拓扑、重叠、消息/算法 |

## 17. Nsight Systems 与 Nsight Compute 分工

### 17.1 Nsight Systems {/* #nsight-systems */}

先看全局时间线：CPU thread、CUDA API、Kernel、Memcpy、NCCL、空洞和同步。回答“时间花在哪个阶段”。

### 17.2 Nsight Compute {/* #nsight-compute */}

再分析少量关键 Kernel：

- Speed of Light；
- occupancy；
- memory workload；
- warp state/stall；
- instruction/Tensor pipeline；
- source correlation；
- roofline。

深度 profiler 有开销，并可能多次 replay Kernel。使用可复现 canary、小时间窗和 NVTX 过滤，不直接全量 profile 长时生产请求。

## 18. 最小实验路线

1. 编写/运行 vector add，验证正确结果。
2. 改变 threads per block：64/128/256/512，记录时间与 occupancy。
3. 对比连续访问和 stride 访问，观察有效/实际带宽。
4. 构造 warp 内分支与 warp 间分支，比较发散。
5. 用 Shared Memory 重用数据，对比 HBM 流量和 occupancy。
6. 连续运行小 Kernel，对比普通 launch 与 CUDA Graph（支持时）。
7. 用 Nsight Systems 找空洞，再用 Compute 分析热点。

每个实验固定 GPU、时钟策略、编译器、架构标志、输入和预热，重复多轮。

## 19. AI 推理中的映射

### 19.1 Prefill {/* #prefill */}

矩阵规模大，通常更容易利用 Tensor Core，计算吞吐与 HBM 都重要。

### 19.2 Decode {/* #decode */}

每步 token 数小，可能受 HBM、Kernel launch、batch 和同步影响。continuous batching 增大有效工作量。

### 19.3 KV Cache {/* #kv-cache */}

读写模式、分页/块布局和有效 batch 影响 HBM 流量。显存容量够不等于带宽够。

### 19.4 Tensor Parallel {/* #tensor-parallel */}

计算 Kernel 间插入 Collective。Kernel 变快后，通信占比可能上升；需要端到端分析。

## 20. 常见误区

1. **Thread 就是 CUDA Core。**线程是逻辑实例，硬件分时/并行执行。
2. **一个 Block 对应一个 SM 整个生命周期独占。**SM 可并驻多个 Block，资源决定。
3. **Occupancy 100% 性能最好。**可能访存低效或算子已达峰。
4. **Local memory 在片上。**spill 常落到 device memory/cache 路径。
5. **分支一定很慢。**关键是同一 warp 是否发散和分支工作量。
6. **GPU Util 高代表 Kernel 高效。**可能做无效计算、等待或低吞吐指令。
7. **mmap/Unified Memory 免除数据路径分析。**page migration/fault 仍有成本。
8. **一次 profile 结果可代表所有 shape。**不同 batch/序列长度会选不同 Kernel。

## 21. 掌握标准

应能解释 Grid/Block/Thread/Warp/SM 映射，计算 occupancy 受哪些资源限制，判断分支发散与 coalescing，区分寄存器/Shared/L2/HBM，使用 Systems→Compute 方法定位 Kernel 性能，并映射到 Prefill/Decode/KV/NCCL。

下一篇：[GPU Roofline 性能模型](../performance/01-GPU-Roofline性能模型.md)。

## 22. 参考资料 {/* #参考资料 */}

- [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)
- [CUDA Programming Model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html)
- [CUDA C++ Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/)
- [Nsight Systems documentation](https://docs.nvidia.com/nsight-systems/)
- [Nsight Compute documentation](https://docs.nvidia.com/nsight-compute/)
