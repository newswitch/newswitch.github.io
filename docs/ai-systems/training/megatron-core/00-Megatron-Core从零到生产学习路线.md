---
title: "Megatron Core 从零到生产学习路线"
sidebar_label: "00. Megatron Core 学习路线"
sidebar_position: 0
description: "通过矩阵分块、流水线时序、Softmax 合并和路由容量推导 Megatron 各类并行的正确性与成本。"
tags: [Megatron Core, Tensor Parallel, Pipeline Parallel, MoE]
---

# Megatron Core 从零到生产学习路线

Megatron Core 是大模型训练并行与高性能组件库。它不是 Kubernetes 调度器，也不只等于 Tensor Parallel；它组合 DP、TP、PP、CP、EP、Sequence Parallel、Distributed Optimizer 和 Distributed Checkpoint，在大规模 GPU 上训练 Dense 或 MoE 模型。

```text
Global World
→ 建立Dense的TP/PP/CP/DP网格与对应Expert网格
→ 模型层和Tensor分布到各Rank
→ Pipeline调度Microbatch
→ 层内Collective与层间P2P
→ 梯度同步和分布式Optimizer
→ 分片Checkpoint
```

## 1. 学习顺序

1. [Process Group、TP、Sequence Parallel 与一次 Transformer 层](./01-Process-Group-TP-Sequence-Parallel与一次Transformer层.md)；
2. [PP、Microbatch、1F1B、CP、EP、MoE 与 Distributed Optimizer](./02-PP-Microbatch-1F1B-CP-EP-MoE与Distributed-Optimizer.md)；
3. [数据、Checkpoint、通信重叠、容量、性能与故障排查](./03-数据-Checkpoint-通信重叠-容量-性能与故障排查.md)。

第一章从 `Y=XW` 的分块推导 Forward 与 Backward 的通信；第二章从依赖时序、全局归一化和路由所有权解释 PP、VPP、CP、EP；第三章解释 Checkpoint 逻辑身份与通信重叠的依赖边界。纸面例子不需要集群，既有工程内容可留作后续对照。

预备知识包括矩阵乘法求导、Softmax、同步数据并行与集合通信。可以配合 [FSDP2 参数生命周期](../fsdp2/01-DTensor-DeviceMesh-fully-shard与一次训练Step.md)比较“长期存储分片”与“层内计算分片”，避免把所有省显存方案当成同一种机制。

## 2. 与其他框架的边界

| 组件 | 角色 |
| --- | --- |
| PyTorch Distributed | Process Group、Collective、Tensor 和 Autograd 基础 |
| Megatron Core | Transformer 并行层、调度、Optimizer、MoE 与 Checkpoint |
| Megatron-LM | 使用 Megatron Core 的完整训练应用和脚本 |
| NeMo | 数据、模型、训练配方和更高层产品化 |
| DeepSpeed/FSDP | 其他模型状态分片与 Runtime 路线 |

## 3. 完成标准

- 给定教学 Rank 编号规则，写出 TP、PP、DP 伙伴；区分独立维度与 Expert 网格重组；
- 从矩阵分块推导 Column/Row Parallel 的形状和归约位置，手算一个 MLP 的前向与反向；
- 解释 SP 为什么能在 LayerNorm 区域切序列，以及其参数梯度为何仍需同步；
- 根据 Microbatch 和 Stage 数画出合法 1F1B 时序，区分气泡占总时间与相对计算的开销；
- 推导 CP 的全局 Softmax 合并，给出直接平均局部输出会算错的反例；
- 从 Top-k 路由推导 Expert 与 Rank 负载、Capacity 和通信量，区分计算稀疏与状态显存；
- 从各项 Buffer 的所有权推导 Distributed Optimizer 账本，解释它为什么不等于完全分片。
- 逐格核对 VPP 的物理 Rank/逻辑 Chunk 时序，并推导 CP 后向 dQ 与 dK/dV 的不同归属；
- 将 Checkpoint 的参数身份、分片区间与新的 TP/PP/EP ownership 对应，说明非张量状态的兼容边界。

本路线的传统 Dense 网格采用 `world_size = TP × PP × CP × DP`，SP 通常复用 TP 组，EP 则要单独检查 Expert 网格映射。新版本引入其他并行维度时，应重新定义模型，不能把这个公式当作所有版本的完整配置约束。

理论掌握的标志是能解释一个新布局为何正确、代价在哪里，以及什么反例会让它失效，而不只是列出并行方式的名称。

参考：[Parallel State](https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.parallel_state.html)、[并行 Linear](https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.tensor_parallel.layers.html)、[Megatron 流水线论文](https://arxiv.org/abs/2104.04473)。
