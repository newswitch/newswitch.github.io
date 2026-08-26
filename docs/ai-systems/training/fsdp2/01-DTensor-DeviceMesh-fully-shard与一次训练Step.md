---
title: "FSDP2 DTensor、DeviceMesh、fullyshard 与一次训练 Step"
sidebar_label: "01. FSDP2 架构与训练路径"
sidebar_position: 1
description: "跟踪参数从 DTensor Shard 到 Forward AllGather、Backward ReduceScatter 和本地优化器更新。"
tags: [FSDP2, DTensor, DeviceMesh, AllGather, ReduceScatter]
---

# FSDP2 DTensor、DeviceMesh、fullyshard 与一次训练 Step

## 1. DeviceMesh

DeviceMesh 给 Rank 建立有名称的逻辑维度。单维 Mesh 可做全分片数据并行；二维 Mesh 可表达节点内 Shard、节点间 Replicate 的 HSDP。

```text
2 nodes × 8 GPUs
Mesh shape = (replicate=2, shard=8)

shard维：节点内高速AllGather/ReduceScatter
replicate维：节点间复制组同步
```

Mesh 维度应匹配物理拓扑。让高频参数 AllGather 穿过低速跨机链路，通常会降低扩展效率。

## 2. DTensor

DTensor 同时保存局部 Tensor 和全局 Placement，例如某一维 `Shard(0)` 或 `Replicate()`。FSDP2 空闲时参数是 DTensor Shard，计算期间临时变为普通完整 Tensor，因此用户代码通常能按原 Module 访问参数。

## 3. 应用顺序

```python
from torch.distributed.fsdp import fully_shard

for block in model.layers:
    fully_shard(block)
fully_shard(model)
```

通常从叶子 Transformer Block 向 Root 应用，使每个 Block 成为一个通信和释放单元。只在 Root 调一次会形成过大的参数 AllGather，显存峰值和等待时间都可能增加。

## 4. Forward

```text
当前Block参数Shard
→ AllGather得到完整参数
→ 运行Forward
→ 按策略Reshard
→ Prefetch下一个Block
```

若参数不在 Forward 后 Reshard，可减少 Backward 前再次 AllGather，但会保持更多完整参数，占用显存。它是显存与通信之间的交换。

## 5. Backward

```text
Backward到达某Block
→ 如已Reshard则再次AllGather参数
→ 计算dgrad/wgrad
→ ReduceScatter梯度
→ 仅保留本Rank梯度Shard
→ Optimizer更新本地参数和状态Shard
```

通信与计算能否重叠取决于 Wrap 粒度、Bucket、CUDA Stream、网络和 Kernel 时间。模型“使用了 FSDP”不代表通信已经隐藏。

## 6. 初始化

大模型不能先在每个 Rank 完整创建再切分。可在 Meta Device 初始化 Module，再由 FSDP2 Materialize 或加载分片 Checkpoint。初始化路径必须避免 Rank 0 内存和网络广播成为瓶颈。

## 7. 观察方法

用 PyTorch Profiler/Nsight 同时观察 AllGather、ReduceScatter 和 GEMM；用 Memory Snapshot 对齐完整参数物化峰值；记录每 Rank Step Time，不能只看平均 GPU 利用率。

参考：[FSDP2 Tutorial](https://docs.pytorch.org/tutorials/intermediate/FSDP_tutorial.html)、[DTensor](https://docs.pytorch.org/docs/stable/distributed.tensor.html)。
