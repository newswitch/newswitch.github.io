---
title: "Megatron Core 从零到生产学习路线"
sidebar_label: "00. Megatron Core 学习路线"
sidebar_position: 0
description: "学习 Megatron Core 的并行进程组、TP、PP、CP、EP、MoE、Distributed Optimizer、数据与 Checkpoint。"
tags: [Megatron Core, Tensor Parallel, Pipeline Parallel, MoE]
---

# Megatron Core 从零到生产学习路线

Megatron Core 是大模型训练并行与高性能组件库。它不是 Kubernetes 调度器，也不只等于 Tensor Parallel；它组合 DP、TP、PP、CP、EP、Sequence Parallel、Distributed Optimizer 和 Distributed Checkpoint，在大规模 GPU 上训练 Dense 或 MoE 模型。

```text
Global World
→ 按TP/PP/CP/EP/DP拆分正交进程组
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

## 2. 与其他框架的边界

| 组件 | 角色 |
| --- | --- |
| PyTorch Distributed | Process Group、Collective、Tensor 和 Autograd 基础 |
| Megatron Core | Transformer 并行层、调度、Optimizer、MoE 与 Checkpoint |
| Megatron-LM | 使用 Megatron Core 的完整训练应用和脚本 |
| NeMo | 数据、模型、训练配方和更高层产品化 |
| DeepSpeed/FSDP | 其他模型状态分片与 Runtime 路线 |

## 3. 完成标准

- 给定 GPU 数、层数、Hidden、Head、Expert 和序列长度设计并行网格；
- 能计算 `world_size = TP × PP × CP × EP相关维度 × DP` 的约束；
- 能解释每个 Transformer 层发生的通信；
- 能分析 Pipeline Bubble、MoE All-to-All 和慢 Rank；
- 能在改变并行拓扑后恢复 Distributed Checkpoint。

参考：[Megatron Core User Guide](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/index.html)、[Parallelism Strategies](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/parallelism-guide.html)。
