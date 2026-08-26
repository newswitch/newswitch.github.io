---
title: "PyTorch Dispatcher、Autograd 与算子执行路径"
sidebar_label: "01. Dispatcher 与算子路径"
sidebar_position: 1
description: "理解 Python API 如何经过 Dispatcher、Dispatch Key、Autograd 和 Backend 实现，最终启动设备 Kernel。"
tags: [PyTorch, Dispatcher, Autograd, ATen, CUDA]
---

# PyTorch Dispatcher、Autograd 与算子执行路径

## 1. 一行代码经过什么

```python
y = torch.nn.functional.linear(x, weight, bias)
```

简化路径：

```text
Python Binding
→ ATen Operator Schema
→ Dispatcher计算Dispatch Key Set
→ Autograd/Autocast/Functionalization等层
→ CUDA/CPU/Composite Kernel实现
→ Library或自定义Kernel
→ CUDA Launch
```

实际路径会因 Tensor Device、Layout、Dtype、Requires Grad、Autocast 和编译模式变化。

## 2. Operator Schema

Schema 定义名称、参数、返回值、Alias/Mutation 语义。Compiler 和 Functionalization 需要知道算子是否原地修改、返回 View 或具有数据依赖控制流。自定义算子 Schema 错误可能在 Eager 模式偶然运行，却让编译、Autograd 或 Distributed 产生错误结果。

## 3. Dispatch Key

Dispatcher 根据 Tensor 和线程状态组合 Key，例如设备 Backend、Autograd、Autocast。它不是简单的 `if device == cuda`。高优先级 Wrapper Key 可以先执行逻辑，再 Redispatch 到下一实现。

排障时同名 Operator 在 CPU、CUDA、Meta/Fake Tensor 或 Autograd 路径可能调用不同 Kernel。

## 4. Autograd

Forward 期间 Autograd 记录反向所需节点和 Saved Tensor。Backward 从输出梯度遍历 Graph，执行对应公式并累积梯度。

显存不仅来自参数：Saved Tensor、临时 Workspace、Gradient、Optimizer State 和通信 Buffer 都可能占用 HBM。Activation Checkpoint 用重新计算换 Saved Tensor 显存。

## 5. Library 与 Kernel

高层 Operator 可能：

- 调用 cuBLAS/cuBLASLt 完成 GEMM；
- 调用 cuDNN 完成卷积/Attention 组件；
- 启动 PyTorch 原生 CUDA Kernel；
- 调用 Triton/FlashAttention 自定义实现；
- 分解成多个更基础 Operator。

Profiler 里的 Operator 时间包含 CPU 调度与异步 Launch，不能直接当作 GPU 执行时间。需要用 CUDA Event 或时间线关联 Kernel。

## 6. 同步陷阱

读取 GPU Tensor 标量、打印 Tensor、某些内存操作和错误检查可能触发 Host 等待 Device。由于 CUDA 异步执行，同步点的耗时可能包含此前排队的所有 Kernel，看起来像“这一行特别慢”。

## 7. 定位方法

1. PyTorch Profiler 找到高耗时 Operator 和调用栈；
2. Nsight Systems 确认 CPU Launch、同步和 GPU Timeline；
3. Nsight Compute 分析目标 Kernel；
4. 检查 Dtype、Shape、Stride、Layout 和实际 Backend；
5. 用最小输入复现并验证数值一致性。

参考：[PyTorch Dispatcher](https://docs.pytorch.org/tutorials/advanced/dispatcher.html)、[Autograd Mechanics](https://docs.pytorch.org/docs/stable/notes/autograd.html)。
