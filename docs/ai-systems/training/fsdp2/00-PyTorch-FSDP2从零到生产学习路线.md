---
title: "PyTorch FSDP2 从零到生产学习路线"
sidebar_label: "00. FSDP2 学习路线"
sidebar_position: 0
description: "从数据并行等价性和参数生命周期开始，推导 FSDP2 分片、显存、通信、重算与拓扑取舍。"
tags: [PyTorch, FSDP2, DTensor, DeviceMesh, 分布式训练]
---

# PyTorch FSDP2 从零到生产学习路线

FSDP 通过在数据并行 Rank 间切分参数、梯度和优化器状态，使单卡无需长期保存完整模型状态。FSDP2 使用 `fully_shard()` 的可组合 API，并以 DTensor 表达分片参数；FSDP1 则以 `FullyShardedDataParallel` Wrapper 为核心。

理论主线是：先证明分片后仍执行同一个逻辑更新，再计算某个时刻有哪些对象存活，最后推导通信和计算能否重叠。下面的生命周期采用 Forward 后重分片的普通单元；Root、累积与特殊策略可能不同。

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

第一章用四 Rank 例子解释参数与梯度所有权，第二章把同一条生命周期量化成显存与通信模型。第三章先推导一致性切面、异步 staging 和 reshard 区间，再保留工程观察内容；理论阅读不必执行其中的故障实验。

预备知识是矩阵乘法的前反向、数据并行平均梯度，以及 AllGather、ReduceScatter、AllReduce 的区别。通信基础见 [NCCL 集合通信](../../../networking/rdma-roce/ai-cluster/02-NCCL集合通信算法与协议.md)，不同精度的训练状态账本见 [ZeRO 与显存优化](<../distributed/03-DeepSpeed ZeRO 与 GPU 显存优化.md>)。

## 2. DDP、ZeRO 与 FSDP2

| 技术 | 状态切分 | 主要使用方式 |
| --- | --- | --- |
| DDP | 不切参数/优化器，梯度 AllReduce | 模型能装入单卡 |
| DeepSpeed ZeRO | 按 Stage 切优化器/梯度/参数 | DeepSpeed Runtime |
| FSDP1 | 参数 Wrapper 与 FlatParameter | 兼容已有 FSDP1 项目 |
| FSDP2 | DTensor + 可组合 `fully_shard` | PyTorch 原生组合并行 |

FSDP2 不是“打开后显存自动最优”。Wrap 粒度、Prefetch、Reshard、混合精度、激活重算、通信拓扑和 Checkpoint 都影响结果。

## 3. 完成标准

- 给定 Rank Mesh，写出 shard 与 replicate 组，以及每个 Rank 保存的全局参数区间；
- 用局部梯度推导全局平均梯度，解释为何 ReduceScatter 后能够本地做逐元素 Adam；
- 画出普通单元与不重分片单元的参数生命周期，指出完整参数、激活和梯度的存活区间；
- 在给定持久 dtype、计算 dtype、归约 dtype 后分别计算显存与通信量，不套用固定“每参数字节数”；
- 比较细粒度分组、预取、HSDP、重算和 Offload，并给出各自不能解决的瓶颈；
- 解释梯度累积、全局范数裁剪与不同有效 Token 数对正确性的影响。
- 定义同一逻辑更新边界的 Checkpoint，区分 staging 与持久化完成，手算跨 world size 的分片读取区间。

能够记住配置名不等于理解。能换一个 Rank 数、消息大小或驻留策略重新推导结果，才达到本路线的理论掌握标准；Checkpoint 恢复与性能排障再检验这些解释是否与实际系统一致。

参考：[PyTorch 2.8 FSDP2 fully_shard](https://docs.pytorch.org/docs/2.8/distributed.fsdp.fully_shard.html)、[DeviceMesh Tutorial](https://docs.pytorch.org/tutorials/recipes/distributed_device_mesh.html)。
