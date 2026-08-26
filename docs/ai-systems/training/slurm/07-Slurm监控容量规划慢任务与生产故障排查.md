---
title: "Slurm 监控、容量规划、慢任务与生产故障排查"
sidebar_label: "07. 监控、容量与故障排查"
sidebar_position: 7
description: "从 Controller、队列、Allocation、Step、Rank 和设备六层建立 Slurm 可观测性与故障树。"
tags: [Slurm, 监控, 容量规划, 性能, 故障排查]
---

# Slurm 监控、容量规划、慢任务与生产故障排查

## 1. 六层状态

```text
slurmctld健康与调度周期
→ Partition/QOS/Account准入
→ Allocation与节点形状
→ slurmd/slurmstepd和cgroup
→ Rank/训练框架
→ GPU/NIC/存储物理数据面
```

Job 为 `RUNNING` 只能证明资源已分配，不能证明训练已经完成第一个 Step。

## 2. 控制面指标

- RPC 速率、延迟、队列和拒绝；
- 主调度与 Backfill 周期；
- Pending Job 数量、年龄和 Reason；
- Node State 与 Drain Reason；
- slurmdbd backlog 和数据库延迟；
- Controller/Backup 状态及配置 Hash。

大量用户高频轮询 `squeue`、`sacct` 也会给 Controller 和数据库制造压力，自动化必须缓存、分页和限频。

## 3. 容量指标

| 指标 | 解释 |
| --- | --- |
| Allocated GPU | 已分配，不等于正在计算 |
| Active GPU | 有有效计算或显存活动 |
| Queue Wait | 提交到开始运行 |
| Eligible Wait | 依赖/限制满足后仍等待资源 |
| Largest Runnable Shape | 当前能立刻满足的最大节点×GPU形状 |
| Fragmentation | 空闲但无法组成目标形状的资源 |
| Goodput | 有效完成训练的 GPU 时间占比 |

按 GPU 型号、Partition、Account、机架和网络域分解，集群总平均值会掩盖局部拥塞。

## 4. 慢任务分析

先拆：

```text
Job总时间 = Queue Wait + Container/Image + Data Stage
            + Distributed Init + Training Steps + Checkpoint + Cleanup
```

训练期间再把 Step 分成 Data、Forward、Backward、Optimizer 和 Communication。比较相同模型/数据/并行参数下所有 Rank，找到慢 Rank 与拓扑、温度、网络、存储的关联。

## 5. 常用证据

```bash
scontrol show job <jobid>
scontrol show node <node>
squeue -j <jobid> -o '%.18i %.2t %.10M %.6D %R'
sacct -j <jobid> --format=JobID,JobName,State,Elapsed,AllocTRES,MaxRSS,ExitCode
sstat -j <jobid>.batch --format=JobID,AveCPU,MaxRSS
sinfo -R
sdiag
```

这些命令说明 Slurm 对象状态；GPU 利用率、NCCL、RDMA 和存储仍需对应工具。

## 6. 故障树

| 现象 | 第一检查点 |
| --- | --- |
| 所有命令超时 | slurmctld、DNS、RPC、认证 |
| 节点 DRAIN | `Reason`、slurmd、硬件/Prolog |
| Job 长期 Pending | Pending Reason、QOS、形状、Reservation |
| 已 Running 无进程 | slurmstepd、Prolog、容器、cgroup |
| 多机初始化超时 | Rank 完整性、PMIx、DNS、端口、NCCL |
| GPU 利用率低 | 数据、CPU、通信、同步、Kernel |
| Job 被取消 | Time Limit、Preemption、管理员、依赖 |
| Accounting 缺失 | slurmdbd、DB、Association、缓存队列 |

## 7. 版本与配置证据

故障记录包含 Slurm 版本、Plugin、`slurm.conf` Hash、作业脚本、容器 Digest、节点列表、环境变量、拓扑和首个失败时间。只保存最终 stderr 无法复现调度和启动条件。

参考：[Slurm Troubleshooting](https://slurm.schedmd.com/troubleshoot.html)、[sacct](https://slurm.schedmd.com/sacct.html)、[sdiag](https://slurm.schedmd.com/sdiag.html)。
