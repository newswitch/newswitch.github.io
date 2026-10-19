---
title: "Slurm 与 HPC 训练集群从零到生产学习路线"
sidebar_label: "00. Slurm 学习路线"
sidebar_position: 0
description: "从 Slurm 控制面、资源模型和调度开始，掌握 GPU、MPI/NCCL、容器、数据、监控与生产排障。"
tags: [Slurm, HPC, GPU, MPI, NCCL, 分布式训练]
---

# Slurm 与 HPC 训练集群从零到生产学习路线

Slurm 是面向批处理和 HPC 的工作负载管理器。它负责资源分配、排队、优先级、进程启动和记账，但不实现模型训练或集合通信。

```text
sbatch/srun请求
→ slurmctld完成优先级与资源分配
→ slurmd在目标节点创建Step
→ cgroup限制CPU/内存/设备
→ PMI/PMIx或MPI启动Rank
→ NCCL/HCCL执行GPU/NPU集合通信
→ slurmdbd记录作业与资源用量
```

## 1. 学习顺序

1. [slurmctld、slurmd、slurmdbd 架构、部署与高可用](./01-slurmctld-slurmd-slurmdbd架构部署与高可用.md)；
2. [Partition、QOS、Account、GRES、TRES 与 GPU 资源模型](./02-Partition-QOS-Account-GRES-TRES与GPU资源模型.md)；
3. [Backfill、优先级、抢占、Gang 与拓扑调度](./03-Backfill-优先级-抢占-Gang与拓扑调度.md)；
4. [cgroup、CPU、GPU、NUMA 与进程亲和性](./04-cgroup-CPU-GPU-NUMA与进程亲和性.md)；
5. [PMI、PMIx、MPI、NCCL、RDMA 与多机训练启动链路](./05-PMI-PMIx-MPI-NCCL-RDMA与多机训练启动链路.md)；
6. [Enroot、Pyxis、Apptainer、数据挂载与 Checkpoint](./06-Enroot-Pyxis-Apptainer数据挂载与Checkpoint.md)；
7. [Slurm 监控、容量规划、慢任务与生产故障排查](./07-Slurm监控容量规划慢任务与生产故障排查.md)；
8. [Job 状态、退出码、信号与 Requeue](./08-Job状态退出码信号与Requeue恢复.md)：区分调度重启、应用恢复和结果正确性；
9. [Fair Tree、历史用量与层级公平性](./09-FairTree历史用量与层级公平性.md)：手算账户树，并结合固定版本源码理解递归排名；
10. [Prolog、Epilog 与作业清理](./10-Prolog-Epilog与作业清理边界.md)：理解执行上下文、失败传播和幂等性。

## 2. 与 Kubernetes 的差异

| 维度 | Slurm | Kubernetes |
| --- | --- | --- |
| 核心对象 | Job、Step、Node、Partition | Pod、Job、Node、Queue扩展 |
| 调度习惯 | 批任务、整组资源、Backfill | 通用声明式工作负载 |
| 进程启动 | `srun`/MPI 与 slurmd | kubelet/容器运行时 |
| 资源记账 | Account/QOS/TRES/slurmdbd | ResourceQuota 加外部成本系统 |
| 服务治理 | 不是主要目标 | Service、Gateway、Controller 丰富 |

两者可以管理不同资源池，也可以通过严格边界共享底层设施；不要让两个调度器同时认为自己独占同一 GPU。

使用 BCM 维护节点时，继续阅读[调度器集成与资源所有权](../../../gpu/bare-metal-fleet/base-command-manager/05-Slurm-Kubernetes集成与资源所有权.md)。配置生成来源、节点供应和每次作业分配属于不同层。

理论学习依次完成四个推演：画出 Job—Allocation—Step—Task；按字段求有效资源限制；用时间线计算 Backfill；从 Global Rank 追踪到 GPU UUID 和进程 cgroup。Slurm 时间片 Gang 与 Kubernetes 的 PodGroup 准入不可混为一谈。

## 3. 完成标准

- 能从 Job 追踪到 Allocation、Step、Task、PID 和 GPU UUID；
- 能解释 Pending Reason，而不是只看 `PD`；
- 能设计 Partition、Account、QOS 和 GPU GRES/TRES；
- 能验证 CPU/GPU/NIC 的 NUMA 绑定；
- 能追踪 `srun → PMIx/MPI → NCCL → RDMA`；
- 能区分调度等待、容器启动、数据加载和训练慢；
- 能用 `sacct` 数据完成容量与公平性分析。

参考：[Slurm Overview](https://slurm.schedmd.com/overview.html)、[Slurm Documentation](https://slurm.schedmd.com/documentation.html)。
