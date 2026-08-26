---
title: "训练 Step 成本、扩展效率与失败任务浪费分析"
sidebar_label: "10. 训练 Step 成本与扩展效率"
sidebar_position: 10
description: "用 GPU-Hour、Tokens、Step、扩展效率、重算和 Checkpoint 恢复量化训练成本。"
tags: [训练成本, 扩展效率, GPU-Hour, Checkpoint, FinOps]
---

# 训练 Step 成本、扩展效率与失败任务浪费分析

## 1. 单位成本

```text
每Step成本 = 分配GPU数 × Step Time × GPU秒单价 + 其他资源
每十亿Token成本 = 训练总成本 / 有效训练Token × 10^9
```

“有效”需要排除 Warmup、失败后丢弃的 Step、重复样本、数值异常和恢复重算。

## 2. 扩展效率

以 `N` 张卡相对基线 `N0`：

```text
Scaling Efficiency = Throughput(N) / (Throughput(N0) × N/N0)
```

扩大卡数后通信、Bubble、数据和慢 Rank 会降低效率。任务更快完成不一定更便宜：若速度提升小于卡数增长，单位 Token 成本会上升。

## 3. Step 分解

```text
Step = Data
     + Forward
     + Backward
     + Optimizer
     + Communication不可重叠部分
     + Bubble/同步等待
```

Profiler 和框架 Timer 必须在所有 Rank 统一口径；只看 Rank 0 会遗漏慢节点。

## 4. 失败浪费

设故障前距离上次有效 Checkpoint 为 `Δt`，恢复和重新加载为 `Tr`：

```text
单次故障浪费GPU小时 ≈ GPU数 × (Δt + Tr + 重放开销)
```

Checkpoint 更频繁会减少重算，却增加 I/O 和训练暂停。最优间隔取决于故障率、保存时间和恢复成本。

## 5. 其他浪费

- 作业已分配但等待数据/镜像；
- World Size 配置错误导致初始化超时；
- OOM 反复重试；
- 梯度 Overflow 后 Step 无效；
- Straggler 让所有 Rank 等待；
- 超额 CPU/内存/GPU 请求；
- 调试任务占用完整多机 Allocation。

## 6. 成本归因

每个 Run 记录模型、数据、代码、并行策略、Precision、硬件、拓扑、Checkpoint 和框架版本。没有可复现配置，成本变化无法归因。

## 7. 优化顺序

先消除失败、等待和错误资源请求，再优化 Kernel。一个 Kernel 提速 10% 若只占 Step 的 20%，理论端到端收益有限；而修复 30% Data Wait 可直接提高 Goodput。

参考：[PyTorch Profiler](https://docs.pytorch.org/docs/stable/profiler.html)、[Megatron Core Parallelism Guide](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/parallelism-guide.html)。
