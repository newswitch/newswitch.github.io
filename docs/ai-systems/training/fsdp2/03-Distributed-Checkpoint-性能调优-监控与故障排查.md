---
title: "FSDP2 Distributed Checkpoint、性能调优、监控与故障排查"
sidebar_label: "03. Checkpoint、性能与排障"
sidebar_position: 3
description: "使用 PyTorch Distributed Checkpoint 保存与重分片 FSDP2 状态，并定位慢 Rank、通信、数据和显存故障。"
tags: [FSDP2, Distributed Checkpoint, Performance, Troubleshooting]
---

# FSDP2 Distributed Checkpoint、性能调优、监控与故障排查

## 1. Checkpoint 必须保存什么

- 模型参数 Shard；
- Optimizer State 与 LR Scheduler；
- Global Step、Epoch、Sampler/Data Cursor；
- RNG State 和混合精度状态；
- DeviceMesh/并行配置、代码和数据版本。

仅保存权重只能用于推理或重新开始 Optimizer，不能称为可继续训练的 Checkpoint。

## 2. Distributed Checkpoint 路径

```text
每Rank构造Sharded State Dict
→ DCP Planner计算Shard到Storage映射
→ 多Rank并行写临时目录
→ 所有Shard与Metadata完成
→ 发布完成标记/原子目录
```

恢复时 DCP 可根据新的 DeviceMesh 重新规划读取和 Reshard。必须实测从不同 World Size 恢复，而不是只在相同集群上 Load 一次。

对象存储不具备普通文件系统 Rename 语义。可用不可变 Checkpoint Prefix、Manifest、校验和和最终 Complete 标志定义提交边界，读取端只选择完整版本。

## 3. 性能分解

```text
Step Time = Data Wait + Forward + Backward + Collective Wait
          + Optimizer + Checkpoint摊销 + 同步/抖动
```

每 Rank 同时记录 Step Time、Data Loader、GPU Kernel、AllGather、ReduceScatter、HBM、网络、CPU 和存储。全局 Step 由最慢 Rank 决定，平均值会掩盖 Straggler。

## 4. 常见性能问题

| 现象 | 证据 | 方向 |
| --- | --- | --- |
| AllGather 等待长 | NCCL Timeline、拓扑、消息大小 | Wrap、HSDP、网卡/GPU 绑定 |
| GPU 周期性空闲 | Data Wait、Checkpoint、CPU | DataLoader、异步保存、线程 |
| 显存峰值 OOM | Memory Timeline、物化单元 | Wrap、Reshard、Prefetch |
| Rank 间 Step 抖动 | 每 Rank P99、主机/网卡 | 慢卡、NUMA、网络、数据分片 |
| Loss 异常 | NaN/Inf、Grad Norm、dtype | 精度、Reduce dtype、数据 |

## 5. 故障定位

Collective Timeout 先找第一个没有进入同一 Collective 的 Rank，再检查其 OOM、DataLoader、CUDA Error 和节点日志。最后一个打印 NCCL Timeout 的 Rank 不一定是根因。

Checkpoint 卡住要分解 Barrier、序列化、每 Rank 写入字节和存储尾延迟。一个慢磁盘/对象存储分片会让所有 Rank 等待。

## 6. 验收实验

用 2→4 GPU 恢复；训练中强杀一个 Rank；填满一个 Rank 的 DataLoader；限速 Checkpoint 存储；制造一张 GPU 降频。恢复后比较 Global Step、Loss、Optimizer 和数据样本连续性。

参考：[PyTorch Distributed Checkpoint](https://docs.pytorch.org/docs/stable/distributed.checkpoint.html)、[PyTorch Profiler](https://docs.pytorch.org/docs/stable/profiler.html)。
