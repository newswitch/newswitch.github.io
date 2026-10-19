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

## 8. 分配利用率与有效产出

教学例子：集群 64 张 GPU，一小时内分配了 48 GPU 小时，分配利用率为 75%。其中 8 GPU 小时等待数据、4 GPU 小时初始化、4 GPU 小时因失败需要重算。若其余 32 GPU 小时都形成有效训练进展，则这个简化口径的有效占比是 50%，不是 75%。

有效产出的定义必须固定：完成 Token、训练 Step、可恢复 Checkpoint 或满足质量门槛的任务，不能把任意 GPU 活动都算 Goodput。不同模型的 GPU 小时也不能不加区分地折算成相同产出。

## 9. 用对照组定位慢节点

若同一训练配置的 8 个 Rank 中只有一个持续慢，应先对齐该 Rank 的输入量、设备型号、CPU/NIC 位置和温控状态。若所有 Rank 每到 Checkpoint 都同时变慢，优先检查共享存储和同步阶段；不能因为所有 GPU 利用率下降就判断有 8 张坏卡。

对照应尽量只改变一个条件：同节点换 GPU、同 GPU 换 NIC、固定输入去掉解码、固定拓扑缩小规模。改变模型、镜像、节点和消息大小后同时恢复，无法证明其中哪项是根因。

## 10. 恢复的闭环

节点进入 Drain 时，先保留 Reason、作业影响范围、首个异常与设备映射；修复后依次验证设备发现、资源注册、隔离、通信与最小工作负载，再允许接收新任务。清除 Drain 标志只是调度动作，不是健康证明。

对 Controller、数据库和登录节点分别监测。登录节点 CPU 很高可能来自用户轮询，Controller RPC 排队也可能来自客户端请求风暴。降低查询频率后恢复，属于控制面负载问题，不应通过“增加 GPU”解决。

## 11. 综合分析题

一个 Job 申请两节点各 4 GPU，长期 Pending；看板显示空闲 8 GPU。第一步不是提高优先级，而是查询空闲资源是否分布在满足型号、Partition、每节点形状和网络约束的节点上。若满足形状，再检查有效配额与预约；若获得 Allocation 却不计算，则进入 Step、容器和 Rank 层。

写出每一步要观察的证据与可能否定当前假设的结果，才构成排障方法。单纯列出十个命令，无法说明为什么执行它们。

参考：[Slurm Troubleshooting](https://slurm.schedmd.com/troubleshoot.html)、[sacct](https://slurm.schedmd.com/sacct.html)、[sdiag](https://slurm.schedmd.com/sdiag.html)。
