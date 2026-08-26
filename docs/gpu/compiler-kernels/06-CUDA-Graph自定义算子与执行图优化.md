---
title: "CUDA Graph、自定义算子与执行图优化"
sidebar_label: "06. CUDA Graph 与自定义算子"
sidebar_position: 6
description: "理解捕获与重放如何降低 CPU Launch 开销，以及静态地址、动态形状和自定义算子的正确性约束。"
tags: [CUDA Graph, 自定义算子, PyTorch, GPU]
---

# CUDA Graph、自定义算子与执行图优化

## 1. CUDA Graph 解决什么

普通执行每次由 CPU 依次 Launch Kernel。Kernel 很小或频率很高时，CPU/Python/Driver Launch 可能让 GPU 出现空洞。CUDA Graph 先捕获一段 GPU 工作，再以较低开销重放。

```text
Warmup
→ 固定内存池和输入Buffer
→ Capture Kernel/Memcpy/依赖
→ Instantiate GraphExec
→ 每次把新数据复制到静态Buffer
→ Replay
```

## 2. 核心约束

- 捕获期间操作必须支持 Capture；
- Tensor 地址和形状通常需保持稳定；
- 动态控制流不能任意改变 Graph；
- RNG 必须使用可捕获且可重放的状态；
- 通信库操作需满足对应版本的 Graph 支持；
- Warmup 和 Capture 使用正确 Stream 与内存池。

LLM 服务常按 Batch/Token Shape 建立多个 Graph Bucket，无法命中时回退 Eager。

## 3. 显存代价

为多个 Shape 保留静态 Buffer 和 Graph Memory Pool 会增加显存。Graph 数过多可能减少 KV Cache 容量，最终让吞吐下降。容量规划同时计算模型、KV、Workspace、Graph Pool 和 Runtime 保留。

## 4. 自定义算子

自定义算子需要定义：

- Schema、Dtype、Device、Shape 和 Stride；
- Forward/Backward；
- Meta/Fake Tensor 行为，支持编译 Shape 推理；
- Mutation/Alias 语义；
- CPU/CUDA 等 Backend；
- Autocast 和数值边界；
- Stream、错误和异步生命周期。

仅实现 CUDA Forward 并不足以安全用于 `torch.compile` 和训练。

## 5. Capture 失败

常见原因：捕获时发生 CPU-GPU 同步、动态内存分配、不支持 API、跨 Stream 依赖错误、Host 回调、形状变化。日志出现 Capture Failed 后要确认服务是失败、回退还是继续使用旧 Graph。

## 6. Correctness

Graph 重放最危险的问题是使用旧 Buffer 或错误 RNG。测试覆盖多请求交错、取消、不同 Shape、并发 Stream 和 Cache 复用。输出比较不能只测一次固定输入。

## 7. 何时有效

用 Nsight Systems 比较：CPU Launch 时间、GPU 空洞、Replay 时间和端到端 TTFT/TPOT。若 Kernel 本身很长且 CPU 已能提前排队，Graph 收益可能很小。

参考：[CUDA Graphs](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#cuda-graphs)、[PyTorch CUDA Semantics](https://docs.pytorch.org/docs/stable/notes/cuda.html)。
