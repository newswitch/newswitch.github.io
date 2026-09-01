---
title: "大模型强化学习与 RL Infra 学习路线"
sidebar_label: "00. RL Infra 学习路线"
sidebar_position: 0
description: "从RLHF、PPO、GRPO的算法对象进入Rollout、Reward、训练、权重同步和Router Replay工程链路。"
tags: [RLHF, PPO, GRPO, RL Infra, Rollout]
---

# 大模型强化学习与 RL Infra 学习路线

RL Infra 不是“会调用一个训练框架”或“知道 PPO 公式”。它要把生成、评分、优势估计、训练和新权重发布组成可持续运行的数据闭环：

```text
Prompt
→ Policy生成Rollout
→ Reward/Verifier评分
→ 计算Log Prob、KL与Advantage
→ Actor更新
→ 权重同步到Rollout Engine
→ 下一轮生成
```

## 1. 前置知识

先掌握：

- Transformer、Tokenizer 和自回归生成；
- vLLM 等推理框架的请求、Scheduler、Worker、ModelRunner 与 Kernel；
- DDP/FSDP/TP/PP/EP、NCCL/HCCL 和 Checkpoint；
- 基本概率、Log Probability、期望、梯度和分布式系统一致性；
- 对象存储、队列、任务调度与可观测性。

建议先读：

- [vLLM V1整体架构与组件职责](../../inference/vllm/01-vLLM-V1整体架构与组件职责.md)
- [TP、PP、DP、EP与MoE推理并行策略](../../inference/vllm/10-TP-PP-DP-EP与MoE推理并行策略.md)
- [Megatron Core流水线、长上下文与MoE](../megatron-core/02-PP-Microbatch-1F1B-CP-EP-MoE与Distributed-Optimizer.md)
- [Checkpoint与断点恢复](../distributed/04-训练任务%20Checkpoint%20与断点恢复.md)

## 2. 阅读顺序

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 1 | [RLHF、PPO、GRPO与RL Infra组件](./01-RLHF-PPO-GRPO与RL-Infra组件.md) | 能区分Actor、Reference、Critic、Reward、Rollout和Trainer |
| 2 | [Rollout、MoE Router Replay与训练数据闭环](./02-Rollout-MoE-Router-Replay与训练数据闭环.md) | 能说明路由信息在哪里产生、如何传递、搬运、回放和度量 |
| 3 | [RL训练的数据、权重同步、调度与故障排查](./03-RL训练的数据-权重同步-调度与故障排查.md) | 能设计版本一致的数据面、权重发布和可恢复执行状态机 |

Kernel 层继续阅读：

- [并行归约、Split-K与确定性Router GEMM](../../../gpu/compiler-kernels/08-并行归约-SplitK与确定性Router-GEMM.md)
- [单算子、算子链与端到端性能归因](../../../gpu/compiler-kernels/10-单算子-算子链与端到端性能归因.md)

## 3. 学习时追踪五条线

```text
样本线：prompt → completion → reward → advantage → minibatch
版本线：policy version → rollout version → training base → published version
概率线：old/current/reference logprob → ratio → clip/KL → loss
资源线：rollout GPU → reward GPU → trainer GPU → storage/network
MoE线：router logits → top-k → dispatch → expert → route replay
```

## 4. 掌握标准

- 能画出 PPO 与 GRPO 的组件差异，并解释 GRPO 为什么可不使用独立 Critic；
- 能说明 Old Policy、Current Policy 和 Reference Policy 不是同一个概念；
- 能解释 Rollout Engine 为什么既是推理系统，也是训练数据生产者；
- 能定义一个可版本化、可校验、可重放的 Experience Schema；
- 能解释 Router Replay 的 Token/Layer/Expert 对齐与梯度边界；
- 能估算路由元数据、Log Prob 和生成 Token 的存储/传输成本；
- 能设计权重同步、反压、Checkpoint 和失败恢复；
- 能将单算子收益与完整 RL Step 吞吐分开归因。

## 5. 一组贯穿问题

学完本模块应能完整回答：

1. 一个 Prompt 在哪里生成多个 Completion，为什么要保存旧策略 Log Prob？
2. Reward Model、Rule Verifier 和 Critic 各自输出什么？
3. PPO 的 Clip 限制了什么，Reference KL 又限制了什么？
4. GRPO 的组内相对优势如何产生，为什么 Group 全同分会出问题？
5. MoE Router 的 Top-k 信息在哪一层产生，为什么公开 OpenAI 响应不是理想载体？
6. Router Replay 如何从 Rollout 侧到 Trainer 侧保持 Token、Layer、Model Version 对齐？
7. 为什么固定路由可能阻断 Router 学习，如何保留需要的梯度？
8. Rollout 比训练快或慢时，系统如何反压而不是无限堆积？
9. 新权重如何原子发布，怎样避免一批 Experience 混用多个策略版本？
10. 一次优化如何分别验证单 Kernel、Rollout、训练 Step 和端到端样本吞吐？

每篇文章都给出了这些问题对应的判断方法和答案，不要求先阅读大段框架源码。
