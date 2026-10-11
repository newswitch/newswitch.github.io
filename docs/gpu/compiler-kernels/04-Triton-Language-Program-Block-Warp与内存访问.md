---
title: "Triton Language 的 Program、Block、Warp 与内存访问"
sidebar_label: "04. Triton Language 基础"
sidebar_position: 4
description: "用向量化 Program Instance 理解 Triton Kernel 的索引、Mask、内存合并、Reduction 与配置调优。"
tags: [Triton Language, GPU Kernel, Warp, Memory Coalescing]
---

# Triton Language 的 Program、Block、Warp 与内存访问

> 本文讨论的是 Triton GPU 编程语言，不是 Triton Inference Server。

## 1. Program Instance

Triton Kernel 通过 Grid 启动多个 Program Instance。每个 Instance 使用 `program_id` 计算一组向量化 Offset，并对这些元素执行 Load、计算和 Store。

```python
@triton.jit
def add_kernel(x, y, out, n: tl.constexpr, BLOCK: tl.constexpr):
    pid = tl.program_id(0)
    offsets = pid * BLOCK + tl.arange(0, BLOCK)
    mask = offsets < n
    values = tl.load(x + offsets, mask=mask) + tl.load(y + offsets, mask=mask)
    tl.store(out + offsets, values, mask=mask)
```

这是教学示例；生产 Kernel 还需处理 Dtype、Stride、Alignment、数值和 Autotune。

## 2. Grid、Block 与 Warp

`BLOCK` 表示一个 Program 处理的元素范围，编译元参数还可能包含 `num_warps`、`num_stages`。它们影响并行度、寄存器、共享内存和隐藏延迟能力。

Block 太小可能增加 Program 调度与重复加载开销；太大可能占用过多寄存器并降低 Occupancy。不存在适用于所有 Shape 的固定值。

### 2.1 三个 Block 概念不能混用

`BLOCK` 是逻辑 Tensor Tile 的元素数，不是 CUDA 线程数；`num_warps` 描述 Program 的 Warp 配置，编译器负责把逻辑元素映射到线程、寄存器和指令。本文讨论常规 NVIDIA CUDA 后端，不能把 Warp=32 套到所有其他后端或新式执行模式。

例如 n=1000、BLOCK=256，Grid 为 `ceil(1000/256)=4`：

| Program ID | 逻辑索引 | 有效元素 |
| --- | --- | ---: |
| 0 | 0～255 | 256 |
| 1 | 256～511 | 256 |
| 2 | 512～767 | 256 |
| 3 | 768～1023 | 232 |

这是一轮 Kernel Launch 的四个 Program，不是四次 Launch。若配置 4 个 Warp，常规模型中每个 Program 有 128 个线程参与，256 个逻辑元素并不是“一元素一线程”；实际分布由 Layout 与编译器决定。减小 BLOCK 会增加 Program 数，但不自动增加 Launch 次数。

## 3. 内存合并

相邻线程/元素访问相邻地址有利于合并事务。Stride 大、转置或不规则 Gather 会增加内存事务。分析：

- Pointer 计算是否连续；
- Load/Store Vectorization；
- Mask 是否导致大量无效 Lane；
- L2/Shared Memory 是否复用；
- 中间结果是否回写 HBM。

### 3.1 用地址跨度解释合并事务

取理想化 NVIDIA Warp：32 个 Lane 各读取一个 FP32，且对应 32 字节对齐的内存 Sector。若 Lane i 访问 `base+4i`，128 字节连续区域覆盖 4 个 Sector；若访问 `base+128i`，则覆盖 32 个 Sector。两者有用数据都是 128 字节，后一种需要触及更多事务区域。

这只是 Sector 计数例子，不是实际 HBM 字节的保证：缓存命中、合并规则和对齐会影响最终 DRAM 流量。[CUDA Best Practices 的合并访问说明](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory)提供了硬件边界。Triton 的向量索引不直接等于 Lane 排布，应结合 Lowering 后的 Layout 判断。

二维 Row-major Tensor 的地址为 `base+i×N+j`，沿 j 访问通常连续，沿 i 访问通常跨步。转置 View 只交换 Shape/Stride 而不复制；要同时理解逻辑下标与物理地址，不能只看 Tensor 形状。

## 4. Mask

最后一个 Block 常超出 Tensor 边界，Mask 防止非法访问。Load 的无效元素需给出适合计算的 `other` 值，例如 Reduction Max 使用负无穷，而不是随意使用 0。

### 4.1 Load 安全不等于归约正确

假设一行只有 `[-5,-2]`，补齐到 4 个逻辑元素。Max 的无效 Lane 应填负无穷；填 0 会把最大值从 -2 改成 0。Sum 的无效 Lane 应填 0，Product 应填 1。Softmax 中 Mask 后的负无穷经 exp 变为 0，不能只在最终 Store 上 Mask，否则无效值已进入分母。

全行被 Mask 时，`-inf - (-inf)` 会产生不定结果；应按接口约定处理空行，例如跳过该块/输出规定的零值，而不是直接套普通归约。Mask 也不意味着没有资源成本：补到 1024 的一行即使只有 513 个有效元素，仍可能占用按整个逻辑 Tile 规划的寄存器与指令资源。

## 5. Reduction 与数值

Softmax、LayerNorm 等包含 Reduction。稳定 Softmax 先减最大值；低精度累加可能影响误差。Kernel 优化必须比较绝对/相对误差，并覆盖极端 Shape、NaN/Inf 和非连续 Tensor。

### 5.1 Tile 越大，片上驻留为什么可能越少

寄存器压力来自同一时刻活跃的值，不只是源代码变量数。累加器、Mask、地址、输入片段和软件流水暂存都占资源。简化的驻留 Block 上限为：

```text
min(架构 Block 上限,
    floor(SM 寄存器数 / 每 Block 寄存器数),
    floor(SM Shared Memory / 每 Block Shared Memory),
    floor(SM 线程上限 / 每 Block 线程数))
```

假设一台教学设备每 SM 有 65536 个 32-bit 寄存器、64 KiB Shared Memory、2048 线程上限；Block 有 256 线程，用 32 KiB Shared。每线程 64 个寄存器时，寄存器允许 4 个 Block，但 Shared 只允许 2 个；每线程升到 160 时，寄存器只允许 1 个 Block。活跃线程因此从 512 变成 256。这里忽略分配粒度、其他架构限制及编译器分配，不能当实际 GPU 配置预测。

强压寄存器数可能导致 Spill：所谓 Local Memory 是线程私有地址空间，不是自动驻留 SM 的快速本地内存，溢出访问可能经过 Cache 到设备内存。反之，较低 Occupancy 若足以隐藏延迟且保住复用，也可能更快。因此目标不是把 Occupancy 数字最大化。

### 5.2 Pipeline Stage 是用容量换重叠

对 BF16 GEMM 的 `BM=64, BN=64, BK=32` Tile，一个阶段的 A/B 数据约为 `2×(64×32+32×64)=8192` 字节。双缓冲约 16 KiB，四阶段约 32 KiB，未计对齐与其他暂存。更多 Stage 可提前取下一块，与当前计算重叠，也可能减少驻留 Block；效果取决于复制延迟、计算时长和资源预算。[Triton 矩阵乘教程](https://triton-lang.org/main/getting-started/tutorials/03-matrix-multiplication.html)给出了 Tile、Stride、配置和 L2 复用的对应关系。

## 6. Autotune

使用不同 Config 针对 Shape Key 选择 Block/Warp/Stage。Key 过细会产生大量编译和缓存，过粗会让不同规模共享低效配置。服务场景应结合真实 Token/Batch 分布。

## 7. 性能判定

计算理论字节和 FLOP，结合 Roofline 判断方向；再用 Nsight Compute 查看实际内存吞吐、Occupancy、Warp Stall 和 Tensor Core 使用。只比较 Kernel Duration 可能忽略编译、Launch 和数值差异。

应能手算尾块 Mask、二维 Stride、Sector 跨度和资源上限，并指出各自假设。下一步用 [GEMM 与 FlashAttention](./05-CUTLASS-GEMM-FlashAttention与融合算子.md)将这些约束放到完整算子，而不是把“BLOCK 更大、Warp 更多”当作通用优化结论。

参考：[Triton Programming Guide](https://triton-lang.org/main/programming-guide/index.html)、[Triton Tutorials](https://triton-lang.org/main/getting-started/tutorials/index.html)。
