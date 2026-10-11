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

### 2.1 捕获的是地址与依赖，不是 Tensor 变量名

设捕获输入 storage 地址为 A，输出为 B。把 Python 变量 `input` 重新绑定到地址 C 不会让图自动读 C；应把新数据放入仍被图引用的 A，或走受支持的更新/重新捕获路径。这里的静态地址描述 PyTorch 2.8 常规捕获重放契约；原生 CUDA Graph 有受条件约束的[节点更新](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html#updating-instantiated-graphs)，不是所有图 API 都绝对禁止更新。

一次安全调用可抽象为 `取得独占 buffer → copy new input → replay → 等待输出相关工作完成 → 消费输出 → 释放使用权`。不同 stream 间必须用 event/wait 等依赖确保 copy 先于 graph 读、输出消费先于下一次覆写。Host 的 replay 调用返回仅表示已排队，不表示设备完成；取消请求也不能立刻把仍在设备使用的 buffer 交给下一请求。

## 3. 显存代价

为多个 Shape 保留静态 Buffer 和 Graph Memory Pool 会增加显存。Graph 数过多可能减少 KV Cache 容量，最终让吞吐下降。容量规划同时计算模型、KV、Workspace、Graph Pool 和 Runtime 保留。

### 3.1 私有池共享有顺序前提

PyTorch allocator 在捕获期间使用 graph-private pool，以保留图依赖的虚拟地址；池存活到相应图对象及捕获期间创建的相关 Tensor 都释放。普通临时 Tensor 的 Python 生命周期结束，不代表捕获图不再需要其地址。[PyTorch 2.8 graph memory management](https://docs.pytorch.org/docs/2.8/notes/cuda.html#graph-memory-management)

两个图共享私有池可能让某些活跃区间不重叠的 buffer 复用地址。PyTorch 文档给出的安全契约是：始终按捕获顺序重放，且不并发重放。若 G1 的中间结果与 G2 复用同一地址，同时执行或乱序执行可能覆盖仍被消费者使用的数据。独立私有池也只避免这一类池内复用，不自动保证共享模型状态、静态输入和输出的并发安全。[Sharing memory across captures](https://docs.pytorch.org/docs/2.8/notes/cuda.html#sharing-memory-across-captures)

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

### 4.1 自定义算子的三层契约

Fake/Meta 实现只推导 shape、dtype、stride 等元数据，不能通过读取真实 GPU 值偷偷确定输出大小；数据依赖输出需要相应的符号尺寸机制或明确不支持。反向注册需要与前向真正的数学和保存值一致。Mutation 声明则决定编译器能否重排、复用和回收输入。[torch.library 的注册契约](https://docs.pytorch.org/docs/2.8/library.html)

设备实现还必须遵守当前 stream 与 storage 生命周期：私自用默认 stream 读取另一个 stream 尚未写完的输入，或在异步 kernel 完成前释放 workspace，可能在 eager 的偶然同步中不暴露，到了 Graph 重放或并发就出错。图捕获成功只证明捕获 API 没报错，不证明这些契约成立。

## 5. Capture 失败

常见原因：捕获时发生 CPU-GPU 同步、不受支持的分配或 API、跨 Stream 依赖错误、Host 回调、形状变化。PyTorch 的捕获感知 allocator 可以支持其管理的分配，不能把所有分配都归为禁止。日志出现 Capture Failed 后要确认服务是失败、回退还是继续使用旧 Graph。

## 6. Correctness

Graph 重放最危险的问题是使用旧 Buffer 或错误 RNG。测试覆盖多请求交错、取消、不同 Shape、并发 Stream 和 Cache 复用。输出比较不能只测一次固定输入。

### 6.1 RNG 和取消也有状态转移

正确捕获的 CUDA RNG 不应每次重放都固定在同一段随机序列。框架需要推进 generator 状态，使 successive replay 使用新的区间；多个 generator 的注册与 graph-safe 状态 API 有版本要求。Dropout 后向或重计算需要恢复对应前向的随机选择，不能随便生成新 mask。CPU 随机数和 Python 分支不会因为包在捕获上下文中就每次重放重新执行。

取消只改变请求是否还需要返回结果，不撤销已经排队的设备访问。正确资源回收条件是所有相关设备工作完成、下游不再持有输出且没有图继续引用应保留的地址。可以忽略结果，但不能把“用户不等了”当作 kernel 已经结束。

## 7. 何时有效

用 Nsight Systems 比较：CPU Launch 时间、GPU 空洞、Replay 时间和端到端 TTFT/TPOT。若 Kernel 本身很长且 CPU 已能提前排队，Graph 收益可能很小。

参考：[CUDA Graphs](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#cuda-graphs)、[PyTorch CUDA Semantics](https://docs.pytorch.org/docs/stable/notes/cuda.html)。
