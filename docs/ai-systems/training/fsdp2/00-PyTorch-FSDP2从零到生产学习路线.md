---
title: "PyTorch FSDP2 从零到生产学习路线"
sidebar_label: "00. FSDP2 学习路线"
sidebar_position: 0
description: "从 DTensor 和 DeviceMesh 开始，学习 fully_shard、参数物化、Reduce-Scatter、混合精度、Checkpoint 和生产排障。"
tags: [PyTorch, FSDP2, DTensor, DeviceMesh, 分布式训练]
---

# PyTorch FSDP2 从零到生产学习路线

FSDP 通过在数据并行 Rank 间切分参数、梯度和优化器状态，使单卡无需长期保存完整模型状态。FSDP2 使用 `fully_shard()` 的可组合 API，并以 DTensor 表达分片参数；FSDP1 则以 `FullyShardedDataParallel` Wrapper 为核心。

```text
空闲时参数保持Shard
→ Forward前AllGather完整参数
→ 计算当前层
→ Reshard释放完整参数
→ Backward重新AllGather
→ 计算梯度并ReduceScatter
→ 每Rank更新本地Shard
```

## 1. 学习顺序

1. [DTensor、DeviceMesh、fully_shard 与一次训练 Step](./01-DTensor-DeviceMesh-fully-shard与一次训练Step.md)；
2. [分片策略、Wrap、混合精度、Activation Checkpoint 与 Offload](./02-分片策略-Wrap-混合精度-Activation-Checkpoint与Offload.md)；
3. [Distributed Checkpoint、性能调优、监控与故障排查](./03-Distributed-Checkpoint-性能调优-监控与故障排查.md)。

## 2. DDP、ZeRO 与 FSDP2

| 技术 | 状态切分 | 主要使用方式 |
| --- | --- | --- |
| DDP | 不切参数/优化器，梯度 AllReduce | 模型能装入单卡 |
| DeepSpeed ZeRO | 按 Stage 切优化器/梯度/参数 | DeepSpeed Runtime |
| FSDP1 | 参数 Wrapper 与 FlatParameter | 兼容已有 FSDP1 项目 |
| FSDP2 | DTensor + 可组合 `fully_shard` | PyTorch 原生组合并行 |

FSDP2 不是“打开后显存自动最优”。Wrap 粒度、Prefetch、Reshard、混合精度、激活重算、通信拓扑和 Checkpoint 都影响结果。

## 3. 完成标准

- 能计算参数、梯度、优化器状态和激活的显存；
- 能画出每层 AllGather 与 ReduceScatter 的时序；
- 能使用 DeviceMesh 组合 Shard 与 Replicate 维度；
- 能从不同 World Size 恢复分片 Checkpoint；
- 能区分训练慢是计算、通信、数据、Checkpoint 还是 Rank 抖动。

参考：[PyTorch FSDP2 fully_shard](https://docs.pytorch.org/docs/main/distributed.fsdp.fully_shard.html)、[DeviceMesh Tutorial](https://docs.pytorch.org/tutorials/recipes/distributed_device_mesh.html)。
