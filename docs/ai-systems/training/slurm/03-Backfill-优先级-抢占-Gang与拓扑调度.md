---
title: "Slurm Backfill、优先级、抢占、Gang 与拓扑调度"
sidebar_label: "03. 调度器与拓扑"
sidebar_position: 3
description: "理解 Slurm 如何在公平性、预约时间、碎片、抢占和网络拓扑之间选择作业。"
tags: [Slurm, Backfill, Priority, Preemption, Topology]
---

# Slurm Backfill、优先级、抢占、Gang 与拓扑调度

## 1. Pending 不等于先到先得

Slurm 先判断作业是否满足 Partition、Account、QOS、Reservation、Dependency 和资源约束，再根据优先级与可用资源调度。启用 Multifactor Priority 时，常见因素包括 Age、Fair-share、Job Size、Partition、QOS 和 TRES。

```text
可运行性过滤
→ 计算Priority
→ 主调度周期尝试分配
→ Backfill在不延迟高优先级预约的前提填补空洞
```

## 2. Backfill

高优先级大任务暂时凑不齐节点时，Backfill 可以运行能在其预计启动前结束的小任务。用户提供合理 `--time` 很重要：申报过长会失去回填机会，申报过短会被超时终止。

Backfill 不是“让小任务插队”，而是在保护已计算预约的前提提高利用率。使用 `sdiag` 观察调度周期、队列深度和 Backfill 性能。

## 3. 抢占

抢占方式可能是 Cancel、Requeue、Suspend 等，具体取决于配置和工作负载能力。训练任务能否安全 Requeue 取决于 Checkpoint：

- 是否定期保存；
- 是否原子完成；
- 重启能否发现最后一个有效版本；
- World Size 或节点变化能否恢复；
- 重复执行是否污染输出。

没有恢复能力的“可抢占训练”只是在主动制造资源浪费。

## 4. Gang 语义

分布式训练需要所有必要 Task 获得资源后再启动。Slurm Allocation 天然以作业请求分配一组节点；`srun` 在 Allocation 内启动 Step。仍需防止用户在部分节点手工启动进程并等待缺失 Rank。

## 5. 碎片和形状

总空闲 64 张 GPU 不代表能运行一个 8 节点 × 8 GPU 的任务。空闲卡可能分散在不同型号、Partition、交换域或只有部分节点完整空闲。

```text
可用容量 = 满足节点形状、类型、拓扑、QOS和时间窗口的资源集合
```

容量看板应展示连续节点形状和最大可启动作业，而不是只显示空闲 GPU 总数。

## 6. 拓扑调度

训练通信对 Leaf/Spine、Rail、Dragonfly 等拓扑敏感。Slurm Topology Plugin 可以提供交换结构信息；作业约束和节点权重也可帮助选择紧凑资源。目标是减少跨高层交换设备的流量，同时避免热点。

对 TP/高频 AllReduce，应尽量让通信密集 Rank 位于更快域；对大规模 DP，则要评估跨域带宽、Collective 算法和故障域。

## 7. 排查 Pending Reason

```bash
squeue -j <jobid> -o '%.18i %.2t %.10M %R'
scontrol show job <jobid>
sprio -j <jobid>
sinfo -N -l
sdiag
```

`Resources`、`Priority`、`QOSMaxGRESPerUser`、`AssocGrpGRES`、`ReqNodeNotAvail` 等 Reason 的处理完全不同。先解释 Reason，再决定是等待、修改请求还是修复节点。

参考：[Multifactor Priority](https://slurm.schedmd.com/priority_multifactor.html)、[Backfill Scheduling](https://slurm.schedmd.com/sched_config.html)、[Preemption](https://slurm.schedmd.com/preempt.html)。
