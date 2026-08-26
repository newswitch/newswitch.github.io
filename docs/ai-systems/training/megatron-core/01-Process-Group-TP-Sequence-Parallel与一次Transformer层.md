---
title: "Megatron Core Process Group、TP、Sequence Parallel 与一次 Transformer 层"
sidebar_label: "01. 进程组与张量并行"
sidebar_position: 1
description: "理解 Megatron 并行网格和 Transformer MLP、Attention 在 TP/SP Rank 间的切分与通信。"
tags: [Megatron Core, Process Group, Tensor Parallel, Sequence Parallel]
---

# Megatron Core Process Group、TP、Sequence Parallel 与一次 Transformer 层

## 1. 正交进程组

同一个 Rank 同时属于多个通信组：Tensor、Pipeline、Data、Context、Expert。不同 Collective 必须在正确组内执行；组大小或 Rank 映射不一致会造成结果错误或通信死锁。

```text
world_size=64
TP=4, PP=4, CP=2
若无EP等额外维度，则DP=64/(4×4×2)=2
```

在真实拓扑中通常让 TP 留在单机 NVLink/NVSwitch 域，PP/DP/CP 是否跨节点取决于消息模式和网络。

## 2. MLP 的 TP

Transformer MLP 可将第一个线性层按输出维切分，每 Rank 计算部分中间维；第二个线性层按输入维切分，最后对部分输出做 Reduce。

```text
X（各Rank可见）
→ ColumnParallelLinear：W1按列切分
→ 每Rank得到HiddenShard
→ 激活
→ RowParallelLinear：W2按行切分
→ AllReduce/ReduceScatter合成输出
```

TP 减少单卡权重和 GEMM 尺寸，但每层都引入通信。小模型或跨慢网扩大 TP 可能比单卡更慢。

## 3. Attention 的 TP

Q/K/V Head 或 Hidden 维按 Rank 切分，各 Rank 计算部分 Attention，再在输出投影处聚合。Head 数、KV Head 数必须满足 TP 切分约束；GQA/MQA 的 KV Head 少时可能限制 TP 或需要复制策略。

## 4. Sequence Parallel

TP 中 LayerNorm、Dropout 等部分操作若在各 Rank 保存完整序列，会复制激活。Sequence Parallel 把这些区域沿 Sequence 切分，通常配合 ReduceScatter/AllGather，降低激活显存。

它不是 Context Parallel。SP 主要与 TP 配合切激活区域；CP 切分 Attention 的长序列计算和 KV，并引入不同通信算法。

## 5. 通信重叠

梯度 Bucket、异步 AllReduce/ReduceScatter 和计算 Stream 可重叠。要满足：计算足够长、通信及时发起、CPU 没有阻塞、网络有带宽。Profiler 中 Collective 与 GEMM 同时出现才证明重叠生效。

## 6. 常见错误

- `world_size` 不能被并行维度乘积整除；
- Head/Expert/Layer 数不能按 TP/PP 均匀切分；
- Rank 到节点映射使 TP 跨节点；
- 部分 Rank 使用不同参数创建 Process Group；
- `CUDA_VISIBLE_DEVICES`、Local Rank 和实际 PCIe 拓扑不一致。

参考：[Megatron Core Parallel State](https://docs.nvidia.com/megatron-core/developer-guide/latest/api-guide/core/parallel_state.html)、[Tensor Parallel API](https://docs.nvidia.com/megatron-core/developer-guide/latest/api-guide/tensor_parallel.html)。
