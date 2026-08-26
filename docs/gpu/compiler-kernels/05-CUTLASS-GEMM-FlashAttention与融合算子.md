---
title: "CUTLASS、GEMM、FlashAttention 与融合算子"
sidebar_label: "05. GEMM、Attention 与融合"
sidebar_position: 5
description: "理解矩阵乘、Tile、Tensor Core、Epilogue 与 IO-Aware Attention，判断专用融合 Kernel 的收益和边界。"
tags: [CUTLASS, GEMM, FlashAttention, Tensor Core, Kernel Fusion]
---

# CUTLASS、GEMM、FlashAttention 与融合算子

## 1. GEMM 是大模型核心工作负载

线性层可表示为：

```text
D = α × A × B + β × C
```

高性能实现把矩阵切成 Thread Block/Warp/Instruction Tile，在 HBM、L2、Shared Memory 和 Register 间分层搬运，并用 Tensor Core 执行 MMA。

## 2. CUTLASS 的层次

CUTLASS 提供 CUDA C++ 模板构建 GEMM 和相关 Kernel。理解重点：

- 数据类型与累加类型；
- Layout 和 Alignment；
- Thread Block/Warp/Instruction Shape；
- Pipeline Stage；
- Epilogue 融合 Bias、Activation、Quantization；
- 目标 GPU 架构和 Tensor Core 指令。

错误 Alignment 或不合适 Shape 可能回退或使用低效 Kernel。

## 3. 算术强度

GEMM 在大 Shape 下通常有较高 Arithmetic Intensity，容易发挥 Tensor Core；小 Batch、窄矩阵或 Decode 场景可能受 Launch、内存和矩阵形状限制。TFLOPS 低不能直接说明 Kernel 差，还需与该 Shape 的可达上限比较。

## 4. FlashAttention 的核心思想

标准 Attention 若物化完整 `S×S` 分数矩阵，会产生大量 HBM 读写。FlashAttention 按 Tile 在片上存储计算，通过 Online Softmax 避免完整中间矩阵写回，减少 I/O。

```text
不是减少Attention数学量
而是重排计算，减少HBM流量和中间存储
```

实际 Backend 还受 Head Dim、Dtype、Mask、因果模式、GQA、GPU 架构和版本限制。

## 5. 融合算子

融合可以减少 Launch 和中间 Tensor HBM 往返，例如 Bias+Activation、RMSNorm、RoPE。边界包括：

- Kernel 太大导致寄存器压力；
- 动态 Shape 产生多个变体；
- 调试和数值验证更复杂；
- 特殊输入回退到非融合路径；
- 编译时间和 Cache 增长。

## 6. 推理与训练差异

Prefill 的大矩阵更接近 Compute Bound；Decode 的小 Batch GEMM/GEMV 更容易受内存和 Launch 限制。训练 Forward/Backward 还包含梯度和更多激活。不能用 Prefill Benchmark 代表 Decode，也不能用 Forward 代表完整训练 Step。

## 7. 验证

比较相同 Shape、Dtype、Layout、Warmup 和同步方式；同时报告数值误差、Kernel 时间、端到端时间、HBM、功耗和编译成本。确认调用的实际 Kernel 名称和 Backend。

参考：[NVIDIA CUTLASS](https://docs.nvidia.com/cutlass/)、[FlashAttention](https://github.com/Dao-AILab/flash-attention)。
