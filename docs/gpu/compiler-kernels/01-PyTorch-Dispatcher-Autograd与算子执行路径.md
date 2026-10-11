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

### 3.1 Wrapper 为什么不能原样再调用自己

可把有效 key 集合抽象为 `K=(Tensor keys ∪ TLS included)-TLS excluded`，再从 K 选最高优先级且可派发的实现。TLS 是线程局部状态，Autocast、no-grad 等模式会改变路径；Composite 注册和 fallthrough 还会影响最终表项，不能只按设备查一次字典。

以 PyTorch 2.8 的普通 CUDA、可求梯度、启用 autocast 的算子为例，忽略未激活的其他 wrapper，AutocastCUDA 的优先级高于 AutogradCUDA，后者又先于数值 CUDA backend。Autocast wrapper 选择 dtype、转换必要输入，并在排除自己的作用域 redispatch；Autograd wrapper 建立需要的反向关系，再向数值实现 redispatch。若 wrapper 不屏蔽自己而原样派发同一调用，会再次选中自身而递归。[2.8 DispatchKey 定义](https://raw.githubusercontent.com/pytorch/pytorch/v2.8.0/c10/core/DispatchKey.h)、[Dispatcher 注册与 redispatch](https://docs.pytorch.org/tutorials/advanced/dispatcher.html)

这不是所有 key 的完整固定排序。View、Functionalize、Python/Fake、稀疏和 Composite 等路径必须看目标版本的 key set、表项与 guard。Inference mode 也不只是“保存的梯度为零”，它会改变 Autograd/View tracking 的参与方式。

## 4. Autograd

Forward 期间 Autograd 记录反向所需节点和 Saved Tensor。Backward 从输出梯度遍历 Graph，执行对应公式并累积梯度。

显存不仅来自参数：Saved Tensor、临时 Workspace、Gradient、Optimizer State 和通信 Buffer 都可能占用 HBM。Activation Checkpoint 用重新计算换 Saved Tensor 显存。

### 4.1 菱形依赖如何累积梯度

设 `u=x*x; y=u+x`，且标量上游梯度 `dy=1`。从 y 到 x 有直接路径贡献 1，经 u 的路径贡献 `x+x=2x`，最终 `dx=2x+1`。反向图不能只沿第一次找到的路径计算；节点要等待所需梯度贡献，并按其规则合并。共享参数在多个位置使用也是这个问题，不是把最后一份梯度覆盖前一份。

叶 Tensor 的 `.grad` 通常累积，因此连续两次 backward 不清零会累加；非叶 Tensor 默认不长期保存 `.grad`，但可能为反向保存值。`retain_graph=True` 保留本次反向需要的图资源；`create_graph=True` 记录导数计算以便继续求导，二者用途不同。正常反向会释放可释放的 saved intermediates，仍持有某个输出 Python 对象不保证可直接第二次 backward。[Autograd mechanics](https://docs.pytorch.org/docs/2.8/notes/autograd.html)

### 4.2 保存值的版本也是正确性条件

若反向公式保存 x，再通过 x 或共享 storage 的 view 原地修改它，后向不能默默用新值代替前向旧值。PyTorch 会对保存值检查版本变化，必要时报告原地修改错误；`no_grad` 不会让旧 saved value 自动成为新值。自定义算子隐瞒 mutation 会破坏这个检测和编译器依赖分析。Activation Checkpoint 则需要重计算使用与原前向相容的参数、输入和 RNG 状态，不能在重算前修改权重。

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
