---
title: "Megatron Core 数据、Checkpoint、通信重叠、容量、性能与故障排查"
sidebar_label: "03. 数据、性能与故障排查"
sidebar_position: 3
description: "把大规模训练的数据加载、分片 Checkpoint、并行拓扑、性能指标和慢 Rank 排查串成完整路径。"
tags: [Megatron Core, Checkpoint, Performance, Troubleshooting]
---

# Megatron Core 数据、Checkpoint、通信重叠、容量、性能与故障排查

## 1. 数据路径

```text
原始文本/对象存储
→ Tokenizer与预处理
→ Indexed Dataset/Shard
→ Data Loader Worker与缓存
→ Data Parallel Sampler
→ Microbatch
→ TP/PP/CP/EP训练网格
```

所有 DP Replica 应读取不同样本，TP/PP/CP 组内 Rank 则协同处理同一逻辑 Microbatch。Sampler State 是 Checkpoint 的一部分，否则恢复后会跳过或重复样本。

Data Loader Worker 数不是越多越好。要检查对象存储并发、本地缓存、CPU Tokenization、Page Cache、NUMA 和每 Rank Data Wait。

## 2. Distributed Checkpoint

Megatron Core 的分片 Checkpoint 描述 ShardedTensor/ShardedObject，可在加载时变更 TP/PP 等拓扑并重新映射。状态包括模型、Distributed Optimizer、RNG、Scheduler、Consumed Samples 和训练参数。

异步保存能隐藏部分存储时间，但 Host 内存必须容纳 Staging Buffer，且训练继续时 Checkpoint 的一致性边界要明确。最终完成标志之前不能被恢复端选择。

## 3. 容量基线

每次实验固定：模型 Config、Token 数、Global/Micro Batch、Sequence Length、并行维度、精度、Activation Recomputation 和硬件拓扑。

核心指标：

- Samples/s、Tokens/s/GPU、Step Time P50/P99；
- Model FLOPs Utilization；
- Forward、Backward、Optimizer、Data 和 Checkpoint 时间；
- TP/PP/CP/EP/DP Collective 字节与等待；
- 每 Rank HBM、SM、功耗、网络和 CPU；
- Loss、Grad Norm、NaN/Inf 和样本进度。

## 4. Straggler 分析

```text
全局Step慢
→ 找每Rank到达Barrier/Collective的时间
→ 找最早偏离的Rank和阶段
→ 该Rank向前查Data、GPU Kernel、OOM、网络、存储
→ 正常Rank上的NCCL Timeout通常只是受害者
```

慢 Rank 可能来自 GPU 降频/ECC、NUMA 错绑、HCA/FEC、Data Shard 热点、后台 Checkpoint 或 CPU 抢占。必须用 Rank、GPU UUID、NIC、Node 和时间戳关联。

## 5. 常见故障

| 故障 | 技术证据 |
| --- | --- |
| 初始化 Hang | Rank 环境、Rendezvous、Process Group 和防火墙 |
| 首个 Step OOM | 并行配置、Microbatch、Sequence、激活和 Buffer |
| 中途 NCCL Timeout | 首错 Rank、Xid、网络 Counter、步骤阶段 |
| MoE 吞吐低 | Expert Token 分布、All-to-All、Grouped GEMM |
| Loss 不一致 | 数据顺序、RNG、精度、Checkpoint 和并行算法 |
| Checkpoint 慢 | 每 Rank 写入、Host Buffer、存储 P99、Barrier |

## 6. 技术验收

完成 1→8 卡再到多机的扩展曲线；制造数据慢 Rank、GPU 降频、网络丢包和 Checkpoint 限速；变更并行拓扑恢复一次；证明性能退化能定位到具体 Rank 和阶段。

参考：[Megatron Core API Guide](https://docs.nvidia.com/megatron-core/developer-guide/latest/api-guide/)、[Megatron Core Quick Start](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/quickstart.html)。
