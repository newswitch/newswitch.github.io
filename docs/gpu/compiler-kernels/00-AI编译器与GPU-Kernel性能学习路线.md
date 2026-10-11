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
8. [并行归约、Split-K 与确定性 Router GEMM](./08-并行归约-SplitK与确定性Router-GEMM.md)；
9. [Decode 融合算子与 HBM 流量优化](./09-Decode融合算子与HBM流量优化.md)；
10. [单算子、算子链与端到端性能归因](./10-单算子-算子链与端到端性能归因.md)。

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
- 能解释 Split-K、Atomic 和归约顺序为什么影响确定性，并为小 M 选择动态 Kernel 或回退路径；
- 能用 HBM 字节账本解释 Decode 融合的收益与寄存器、Occupancy 边界；
- 能把单 Kernel、算子链、模型 Step 与在线 SLO 分开测量，避免错误归因。

## 4. 理论推导与阅读检查

如果以理论为主，可按 01 → 02 → 03 → 04 → 05 → 06 → 08 → 09 → 10 阅读；已有实践章节不必作为前置任务。按下面的推导检验理解，不以记住术语数量衡量掌握程度：

| 章节 | 理论主线 | 不看原文应能完成 |
| --- | --- | --- |
| 01 | Dispatch Key、redispatch、Autograd 累积与生命周期 | 解释 wrapper 递归反例，推导菱形图梯度 |
| 02 | Guard、路径特化、动态尺寸、Bucket 与编译摊销 | 区分缓存不命中与 Graph Break；计算 Padding 与回本次数 |
| 03 | Saved Tensor、函数式更新、Loop IR 与 Layout Lowering | 推导别名版本和具体地址，证明输出 ownership |
| 04 | Program/线程映射、Stride、Mask、资源驻留与流水 | 手算尾块、事务跨度、寄存器/Shared 上限 |
| 05 | GEMM Tile、Online Softmax、FA2/FA3、Dropout/GQA 后向 | 合并 Softmax，画异步缓冲代次，推导共享 KV 梯度 |
| 06 | 私有池、静态地址、RNG 与异步使用权 | 指出并发/乱序重放和过早释放的反例 |
| 08 | 舍入误差、Split-K workspace、persistent 调度 | 手算归约深度、任务数和归约流量 |
| 09 | Decode 权重/KV 账、融合流量、量化元数据、Amdahl | 区分容量和流量，解释为什么压缩比不等于加速比 |
| 10 | 关键路径、重叠执行、流水吞吐与排队 | 计算瓶颈切换，区分局部 duration 与墙钟收益 |

05 是 Online Softmax 与 Attention 梯度的主要理论归属；Context Parallel 章节只解释其跨 Rank 应用。Roofline 的通用定义仍以 [性能模型](../performance/01-GPU-Roofline性能模型.md)为主，不在各章复制整套定义。

## 5. 模型边界与进一步阅读

上述编译、Attention、执行图与归约缺口已有对应推导。学习时仍须区别三层结论：数学恒等式、明确假设下的教学成本模型、具体版本的实现契约。前两层帮助解释机制，不能直接替代第三层的源码和架构约束。

更进一步可沿目标版本源码追踪实际 IR pass、指令布局与同步协议，用反例检验自己的推导；这是对实现的专门研究，不是这里仍待补写的一套通用公式。跨系统的理论阅读入口见[理论推导阅读与掌握检查](../../learning/03-理论推导阅读与掌握检查.md)。

参考：[PyTorch Compiler](https://docs.pytorch.org/docs/stable/torch.compiler.html)、[Triton Documentation](https://triton-lang.org/main/index.html)。
