---
title: "AOTAutograd、Inductor 与 Triton 代码生成链路"
sidebar_label: "03. Inductor 代码生成链路"
sidebar_position: 3
description: "理解联合前后向捕获、算子分解、Loop IR、调度、融合与 Triton/C++ 代码生成。"
tags: [AOTAutograd, TorchInductor, Triton, Compiler]
---

# AOTAutograd、Inductor 与 Triton 代码生成链路

## 1. 编译栈分工

```text
TorchDynamo：捕获Python前向Graph
→ AOTAutograd：得到可编译Forward/Backward并管理Saved Tensor
→ Decomposition：复杂ATen算子分解
→ Inductor：Loop级IR、依赖、融合和调度
→ Triton/C++：生成GPU/CPU代码
→ 编译、Autotune和Cache
```

每层都有独立失败和性能边界。看到 Triton Compile 日志，不代表用户代码直接使用了 Triton Language。

## 2. AOTAutograd

AOTAutograd 在 Ahead-of-Time 方式追踪 Autograd，生成 Forward 和 Backward Graph。Partitioner 决定哪些中间值保存、哪些在 Backward 重算，直接影响 HBM 与计算量。

训练数值问题需比较 Forward 输出、Gradient、Optimizer 更新，不只比较 Loss 一次。

## 3. Decomposition

后端不需要原生支持每个高层 ATen Operator，可将它们分解为更基础运算。分解有助于融合，但也可能丢失已有专用 Library Kernel 的优势。查看最终 Graph 和 Kernel，而不是从 Python Operator 名猜实现。

## 4. Inductor 调度与融合

Inductor 分析 Loop、依赖和 Buffer，尝试融合 Producer/Consumer，减少中间 Tensor 写回 HBM 和 Launch 数。融合受以下限制：

- 数据依赖和 Reduction；
- Layout/Stride 不兼容；
- Mutation/Alias；
- 资源用量过高导致 Occupancy 下降；
- 专用 External Kernel 边界。

融合不是越多越好。超大 Kernel 可能寄存器溢出或降低并发。

## 5. Autotune

GEMM 或 Triton Kernel 可能测试多个 Block、Warp、Stage 配置。Autotune 增加首次编译时间，并可能在共享 GPU 上得到受干扰结果。生产可通过离线预热、受控 Cache 和固定版本降低不确定性。

## 6. Cache Key

缓存通常与代码、Shape/Guard、设备能力、编译器版本、Driver/Runtime 和配置相关。跨不同 GPU 架构盲目复用二进制可能失败或低效。缓存目录要有版本命名、容量、校验、并发锁和逐出策略。

## 7. 故障分层

```text
Dynamo未捕获 → Python/Graph Break
AOT失败 → Autograd/Functionalization/Mutation
Inductor失败 → Lowering/IR/Scheduler
Triton编译失败 → 生成代码/Compiler/工具链
Kernel运行失败 → Shape/地址/设备/Driver
结果错误 → 数值精度/竞态/自定义算子语义
```

参考：[TorchInductor](https://docs.pytorch.org/docs/stable/torch.compiler_inductor_profiling.html)、[AOTAutograd](https://docs.pytorch.org/functorch/stable/notebooks/aot_autograd_optimizations.html)。
