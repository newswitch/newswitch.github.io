---
title: "AI 编译器与 GPU Kernel 性能学习路线"
sidebar_label: "00. 编译器与 Kernel 学习路线"
sidebar_position: 0
description: "从 PyTorch Dispatcher 和 torch.compile 开始，掌握 Inductor、Triton Language、CUTLASS、CUDA Graph 与算子级性能定位。"
tags: [PyTorch, torch.compile, Inductor, Triton, CUDA Kernel]
---

# AI 编译器与 GPU Kernel 性能学习路线

AI Infra/SRE 不一定要手写高性能 Kernel，但必须能判断延迟和利用率问题位于 Python、Graph Capture、Compiler、Generated Code、Kernel 还是设备。

```text
Python Model
→ PyTorch Dispatcher/Autograd
→ TorchDynamo捕获Graph
→ AOTAutograd拆分Forward/Backward
→ Inductor生成Loop/调度
→ Triton/CUDA/C++代码
→ 编译与缓存
→ Kernel Launch
→ GPU SM/HBM
```

## 1. 学习顺序

1. [PyTorch Dispatcher、Autograd 与算子执行路径](./01-PyTorch-Dispatcher-Autograd与算子执行路径.md)；
2. [torch.compile、Dynamo、Graph Break 与 Dynamic Shape](./02-torch-compile-Dynamo-Graph-Break与Dynamic-Shape.md)；
3. [AOTAutograd、Inductor 与 Triton 代码生成链路](./03-AOTAutograd-Inductor与Triton代码生成链路.md)；
4. [Triton Language 的 Program、Block、Warp 与内存访问](./04-Triton-Language-Program-Block-Warp与内存访问.md)；
5. [CUTLASS、GEMM、FlashAttention 与融合算子](./05-CUTLASS-GEMM-FlashAttention与融合算子.md)；
6. [CUDA Graph、自定义算子与执行图优化](./06-CUDA-Graph自定义算子与执行图优化.md)；
7. [编译缓存、冷启动、Nsight 与算子到 Kernel 定位](./07-编译缓存冷启动Nsight与算子到Kernel性能定位.md)。

## 2. 三类性能问题

| 类型 | 典型现象 |
| --- | --- |
| Host/Launch Bound | GPU 时间线有大量空洞，小 Kernel 频繁启动 |
| Compute Bound | Tensor Core/ALU 接近上限，HBM 余量较大 |
| Memory Bound | HBM/L2 流量高，计算单元等待数据 |

GPU Utilization 是时间占用近似，不能告诉你 Kernel 是否有效利用 Tensor Core，也不能区分有用计算和低效 Kernel。

## 3. 完成标准

- 能从 Python 调用追到 Dispatcher、ATen Operator 和 CUDA Kernel；
- 能解释一次 Graph Break 为什么制造新的编译区间和 Host 开销；
- 能读懂 Inductor/Triton 生成代码的基本索引与 Mask；
- 能用 Arithmetic Intensity 判断 GEMM/Attention 的瓶颈方向；
- 能说明 CUDA Graph 的静态地址和重放约束；
- 能把冷启动拆成模型加载、Graph Capture、代码生成、编译和 Autotune；
- 能用 Profiler/Nsight 给出证据而不是只看 GPU 利用率。

参考：[PyTorch Compiler](https://docs.pytorch.org/docs/stable/torch.compiler.html)、[Triton Documentation](https://triton-lang.org/main/index.html)。
