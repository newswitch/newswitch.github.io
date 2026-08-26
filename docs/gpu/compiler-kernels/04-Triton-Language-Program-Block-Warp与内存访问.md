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

Block 太小会增加 Program/Launch 开销；太大可能占用过多寄存器并降低 Occupancy。不存在适用于所有 Shape 的固定值。

## 3. 内存合并

相邻线程/元素访问相邻地址有利于合并事务。Stride 大、转置或不规则 Gather 会增加内存事务。分析：

- Pointer 计算是否连续；
- Load/Store Vectorization；
- Mask 是否导致大量无效 Lane；
- L2/Shared Memory 是否复用；
- 中间结果是否回写 HBM。

## 4. Mask

最后一个 Block 常超出 Tensor 边界，Mask 防止非法访问。Load 的无效元素需给出适合计算的 `other` 值，例如 Reduction Max 使用负无穷，而不是随意使用 0。

## 5. Reduction 与数值

Softmax、LayerNorm 等包含 Reduction。稳定 Softmax 先减最大值；低精度累加可能影响误差。Kernel 优化必须比较绝对/相对误差，并覆盖极端 Shape、NaN/Inf 和非连续 Tensor。

## 6. Autotune

使用不同 Config 针对 Shape Key 选择 Block/Warp/Stage。Key 过细会产生大量编译和缓存，过粗会让不同规模共享低效配置。服务场景应结合真实 Token/Batch 分布。

## 7. 性能判定

计算理论字节和 FLOP，结合 Roofline 判断方向；再用 Nsight Compute 查看实际内存吞吐、Occupancy、Warp Stall 和 Tensor Core 使用。只比较 Kernel Duration 可能忽略编译、Launch 和数值差异。

参考：[Triton Programming Guide](https://triton-lang.org/main/programming-guide/index.html)、[Triton Tutorials](https://triton-lang.org/main/getting-started/tutorials/index.html)。
