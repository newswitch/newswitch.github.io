---
title: "Megatron Core PP、Microbatch、1F1B、CP、EP、MoE 与 Distributed Optimizer"
sidebar_label: "02. 流水线、长上下文与 MoE"
sidebar_position: 2
description: "理解 Pipeline 调度、Context Parallel、Expert Parallel、MoE Token Dispatch 和优化器分片。"
tags: [Megatron Core, Pipeline Parallel, Context Parallel, Expert Parallel, MoE]
---

# Megatron Core PP、Microbatch、1F1B、CP、EP、MoE 与 Distributed Optimizer

## 1. Pipeline Parallel

PP 沿模型深度切层。Stage 间传递激活和梯度；一次 Global Batch 被拆成多个 Microbatch，流水线才能同时工作。

```text
Stage0: F0 F1 F2 ... B0 B1 B2
Stage1:    F0 F1 ... B0 B1
Stage2:       F0 ... B0
```

GPipe 先全部 Forward 再 Backward，激活峰值高；1F1B Warm-up 后交替 Forward/Backward，降低激活。Pipeline Bubble 近似随 Stage 数增加、Microbatch 数不足而恶化。

Virtual Pipeline 把每个物理 Stage 再分成多个模型 Chunk，交错执行以减少 Bubble，但调度和 P2P 更复杂。层耗时不均会使最慢 Stage 限制全流水线。

## 2. Context Parallel

CP 沿序列维切 Attention 输入/KV，面向超长上下文。权重仍复制在 CP 组，因此权重梯度需要同步。不同 CP 通信实现可能使用 P2P、AllGather 或 All-to-All，选择依赖序列长度、Attention 实现和拓扑。

CP 降低单卡激活/KV 压力，但增加 Attention 通信；短序列不应盲目启用。

## 3. Expert Parallel 与 MoE

EP 把 Experts 分配到不同 Rank。Router 为每个 Token 选择 Top-k Expert，然后执行：

```text
Token打分
→ 按目标Expert重排
→ All-to-All发送到Expert Rank
→ Grouped GEMM计算
→ All-to-All返回原Rank
→ 按原Token顺序合并
```

MoE 性能常受 Token 不均衡、All-to-All、Expert Capacity、Padding 和小 GEMM 影响。平均 GPU 利用率无法显示某个 Expert Rank 被打满，应观测每 Expert Token、丢弃/溢出和 Rank 时间。

TP 与 EP 同时使用时通常要求 Sequence Parallel；具体约束以当前 Megatron Core 版本为准。

## 4. Distributed Optimizer

它在 Data Parallel Rank 间切 Optimizer State，并可进一步切 Gradient/Parameter，思想与 ZeRO 相近。以 BF16 参数、FP32 梯度为例，官方模型给出的每参数状态字节会随 DP 大小下降。

```text
Backward梯度产生
→ Bucket ReduceScatter
→ 每Rank只保留本地梯度Shard
→ 更新本地Optimizer State和参数Shard
→ AllGather更新后参数供下一Step
```

## 5. 组合顺序

先用 TP 解决单层不能装下或大 GEMM；PP 解决模型深度；CP 解决长序列；EP 解决 MoE；DP 填满剩余 GPU 并扩 Global Batch。每增加一个维度，都要重新计算通信、Batch、Checkpoint 和故障域。

参考：[Megatron Parallelism Guide](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/parallelism-guide.html)、[Distributed Optimizer](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/features/dist_optimizer.html)。
