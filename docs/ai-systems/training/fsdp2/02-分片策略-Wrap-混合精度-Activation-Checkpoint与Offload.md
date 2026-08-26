---
title: "FSDP2 分片策略、Wrap、混合精度、Activation Checkpoint 与 Offload"
sidebar_label: "02. 显存与通信优化"
sidebar_position: 2
description: "从模型状态和激活显存出发，选择分片拓扑、Wrap 粒度、精度、重算和 CPU Offload。"
tags: [FSDP2, Mixed Precision, Activation Checkpoint, CPU Offload]
---

# FSDP2 分片策略、Wrap、混合精度、Activation Checkpoint 与 Offload

## 1. 显存账本

```text
峰值显存
= 参数Shard与临时完整参数
+ 梯度Shard
+ Optimizer State Shard
+ 激活
+ 通信Buffer
+ CUDA Context/Allocator碎片
```

全分片主要压缩模型状态；长序列训练中激活可能成为最大项，需要 Activation Checkpoint 或 Sequence/Context Parallel。

## 2. Wrap 粒度

| 粒度 | 优点 | 代价 |
| --- | --- | --- |
| 整模型 | 配置简单 | AllGather 大、峰值高、重叠差 |
| Transformer Block | 通信和释放粒度均衡 | 常用生产基线 |
| 过细子层 | 单次 Buffer 小 | Collective 数量多、启动开销高 |

选择标准是“单元参数量能否让通信与当前/相邻计算重叠”，不是越细越省显存。

## 3. 1D FSDP 与 HSDP

1D 在所有 DP Rank 间 Shard，单卡状态最少，但 AllGather/ReduceScatter 穿过全局网络。HSDP 在节点内 Shard、节点间 Replicate，减少跨节点通信频率，但每个复制组保留一份状态。

```text
world_size = replicate_size × shard_size
```

选择 HSDP 时同时计算故障域、Checkpoint 副本、跨节点带宽和每卡显存。

## 4. 混合精度

参数计算 dtype、Reduce dtype、Buffer dtype 和 Optimizer Master Weight 可以不同。BF16 通常比 FP16 更不易溢出，但具体硬件和模型决定。Reduce 使用 FP32 更稳定但通信字节增加。

需要监控 Loss Scale、NaN/Inf、梯度范数和溢出 Rank。训练不报错但 Loss 漂移同样是失败。

## 5. Activation Checkpoint

不保存部分 Forward 激活，在 Backward 时重算。它以额外计算换显存，适合激活占比高的 Block。对随机操作必须保证 RNG 状态正确；重算范围过大可能使 Step Time 显著上升。

## 6. CPU Offload

把参数/梯度/Optimizer 移到 Host 可进一步降低 GPU 显存，但受 PCIe、Pinned Memory、NUMA 和 Host RAM 约束。Offload 不是免费扩容：若每层都等待 PCIe，GPU 会长期空闲。

## 7. 调参顺序

先建立 BF16、固定 Wrap 的正确性基线；再逐一启用混合精度、Activation Checkpoint、Prefetch/HSDP/Offload；每次记录峰值显存、Step Time、通信占比和 Loss。不要同时修改所有参数后只比较吞吐。

参考：[FSDP Notes](https://docs.pytorch.org/docs/stable/notes/fsdp.html)、[Activation Checkpointing](https://docs.pytorch.org/docs/stable/checkpoint.html)。
