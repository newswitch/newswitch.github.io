---
title: "TorchTitan 与 PyTorch 原生大模型训练架构"
sidebar_label: "01. TorchTitan 训练架构"
sidebar_position: 1
description: "理解 TorchTitan 如何组合 PyTorch 原生张量并行、FSDP、流水线、Context Parallel 与分布式 Checkpoint。"
tags: [TorchTitan, PyTorch, FSDP, Tensor Parallel, 大模型训练]
---

# TorchTitan 与 PyTorch 原生大模型训练架构

## 1. TorchTitan 的定位

TorchTitan 是基于 PyTorch 原生分布式能力构建的大模型训练参考平台。它不是新的 GPU 通信库，也不是 Kubernetes/Slurm 调度器，而是把模型、数据、并行、Checkpoint 和配置组合成可扩展训练程序。

```text
torchrun/调度器启动Rank
→ TorchTitan配置与模型定义
→ DeviceMesh规划并行维度
→ TP/CP/PP/FSDP等并行化
→ torch.compile与激活重算
→ NCCL执行Collective
→ Distributed Checkpoint保存状态
```

项目演进较快，具体模型、配置字段和实验能力应以使用版本的 README 与源码为准。

## 2. 可组合并行

DeviceMesh 为并行维度命名，例如 `dp_replicate`、`dp_shard`、`tp`、`pp`、`cp`。每个 Rank 同时属于多个 Process Group：

```text
World Size = DP_replicate × DP_shard × TP × PP × CP
```

不是所有组合都适合所有模型。Layer、Head、Sequence、Expert 数需要满足切分约束，Rank 布局还应匹配 NVLink、NIC 和节点边界。

## 3. 与 FSDP2/Megatron Core

| 技术 | 定位 |
| --- | --- |
| FSDP2 | PyTorch 参数/梯度/优化器分片原语 |
| Megatron Core | 大模型并行组件和高性能 Transformer 实现 |
| TorchTitan | 组合 PyTorch 原生能力的训练参考平台 |

三者存在能力交集，但不是简单替代关系。选型比较模型支持、并行规模、Kernel、Checkpoint、社区版本和团队改造成本。

## 4. 一次 Step

```text
DataLoader得到Batch
→ PP切Microbatch（若启用）
→ TP/CP执行分片Attention与MLP
→ FSDP AllGather参数Shard
→ Forward/Backward
→ ReduceScatter梯度
→ Optimizer更新本地Shard
→ 更新Metric或保存Checkpoint
```

Profiler 中要区分 FSDP Collective、TP/CP 通信和 PP Bubble。

## 5. Checkpoint

分布式 Checkpoint 需要保存 Model、Optimizer、Scheduler、RNG、DataLoader 位置和训练 Step。验证不同 World Size 是否支持 Reshard，而不是假定所有状态都能自动转换。

## 6. 生产关注

- 配置和代码 Revision 不可变；
- 通信拓扑与 DeviceMesh 映射；
- 编译 Cache 和冷启动；
- 所有 Rank 结构化日志；
- Checkpoint 保存/恢复时间；
- 数值、吞吐和扩展效率基线；
- 新版本对 Model/Parallel API 的兼容性。

## 7. 学习实验

先单机运行小模型，再分别开启 FSDP、TP、Compile 和 Activation Checkpoint；每次只改变一个维度。最后扩到两节点，比较 Step Time 分段、显存和 Collective。

参考：[TorchTitan](https://github.com/pytorch/torchtitan)、[PyTorch Distributed Overview](https://pytorch.org/tutorials/beginner/dist_overview.html)。
