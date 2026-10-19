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

分布式训练需要获得足够资源，并让必要 Rank 完成启动与 rendezvous。Slurm 的整组 Allocation 可以满足资源申请层面的要求，但不保证应用进程已经同时就绪。

Slurm 官方所说的 Gang Scheduling 主要指时间片共享：同一 Partition 中多个作业可以分配到重叠资源，调度器交替挂起和恢复作业。它不是 Kubernetes/Volcano 常说的 PodGroup 最小集合准入。启用 `PreemptMode=GANG` 也不是让 DDP 自动获得“所有 Rank 同时启动”的开关。

时间片挂起的作业仍占用内存；挂起也不应被理解成释放 GPU 显存和所有设备状态。因此 CPU 时间片共享不能直接推导为适合任意 GPU 训练。要分别核对资源插件、抢占模式、显存占用及应用恢复能力。

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

## 8. 手算一次 Backfill

设同构集群有 4 个节点，当前作业 R 占 2 个节点，预计在第 40 分钟结束。排队顺序为 A、B、C，A 优先级最高，需要 4 个节点；B 需要 2 个节点、申报时长 20 分钟；C 需要 2 个节点、申报时长 60 分钟。

```text
时刻       节点 1 和 2          节点 3 和 4
0～20      R                   B
20～40     R                   空闲
40 起      A                   A
```

在无其他约束、资源可用预测准确的教学模型中，B 可以回填，因为它在 A 的预计启动前结束；C 不能按这份 60 分钟申请回填，否则会推迟 A。A 的预约不是节点已经交给 A，B 获得的是受时间窗口约束的机会。

真实 Backfill 还受搜索深度、周期预算、Partition/Reservation、资源保留粒度和拓扑限制影响，因此“理论上能放进去”不等于下一周期必然安排。作业低报时长可能被终止，不能把缩短申请当作无成本优化。

## 9. 公平性与优先级的时间尺度

Fair-share 关注账户历史资源使用及份额，作业优先级则还包含 Age、QOS、Partition 等因素。不要把“某账户昨天用得多”直接推导为它今天所有作业都排最后，实际权重、衰减和账户树会改变结果。

同样，总空闲 GPU 数不足以决定公平性：整组请求不可拆、型号不可替换、网络位置受限时，份额只能在可行资源集合中实现。诊断时应把“有资格获得资源”与“资源能按要求放置”分开记录。

## 10. 抢占是否值得

假设一个训练每 30 分钟完成一次 Checkpoint。若保存成功后又训练了 12 分钟被取消，从最近 Checkpoint 恢复至少要重做这 12 分钟，还要加重新排队、镜像准备、恢复及数据重放时间。若保存尚未完成，应回到更早的完整版本，损失可能更大。

因此抢占策略不只比较优先级，还应考虑可恢复性、已完成但未持久化的工作、恢复时间和受影响 Rank 数。Suspend、Cancel、Requeue 各有不同资源与生命周期含义，不能统一描述为“暂停后继续”。

## 11. 从源码看未来资源表

以 `slurm-25-05-9-1` 的 `src/plugins/sched/backfill/backfill.c` 为阅读基线。在 `_attempt_backfill` 中可以找到 `build_job_queue`、`sort_job_queue`、资源试算和 `_add_reservation`；后者维护 `node_space` 这样的时间与资源映射。它不是简单地遍历“当前空闲节点”，而是在不同时间窗口内检查可行性。

教学伪逻辑如下，不是可直接编译的源码摘录：

```text
构造并排序候选作业
对候选检查资格、预约及资源约束
在未来时间窗口试算可行放置
若可现在开始，尝试启动
否则按规则记录未来占用，保护后续搜索中的时间窗口
达到时间、深度或表容量等预算后结束本轮
```

这解释了两个特色：Backfill 能使用时间维度的空洞；完整搜索又受控制面成本限制，不能无限穷举。这里的内部未来资源记录也不能与管理员显式创建的 Slurm Reservation 对象直接等同。

阅读时沿[候选构造](https://github.com/SchedMD/slurm/blob/slurm-25-05-9-1/src/plugins/sched/backfill/backfill.c#L2147)和[未来资源记录](https://github.com/SchedMD/slurm/blob/slurm-25-05-9-1/src/plugins/sched/backfill/backfill.c#L3867)追踪，比逐行复述整份文件更容易理解设计。该标签用于固定学习材料，不是部署版本推荐。

## 12. 掌握检查

解释 B 为什么可回填而 C 不可；说明 A 的申请改为需要 2 节点后结果为何可能改变；再区分整组 Allocation、Slurm 时间片 Gang、Volcano 最小集合准入与应用 rendezvous。四者回答不同问题，不能互相代替。

参考：[Multifactor Priority](https://slurm.schedmd.com/priority_multifactor.html)、[Backfill Scheduling](https://slurm.schedmd.com/sched_config.html)、[Preemption](https://slurm.schedmd.com/preempt.html)、[Gang Scheduling](https://slurm.schedmd.com/gang_scheduling.html)。
