---
title: "Slurm Partition、QOS、Account、GRES、TRES 与 GPU 资源模型"
sidebar_label: "02. 队列、账户与 GPU 资源"
sidebar_position: 2
description: "掌握 Slurm 的资源池、权限、配额、记账和 GPU 设备描述，避免请求资源与实际设备不一致。"
tags: [Slurm, Partition, QOS, GRES, TRES, GPU]
---

# Slurm Partition、QOS、Account、GRES、TRES 与 GPU 资源模型

## 1. 五个概念不能混用

| 概念 | 回答的问题 |
| --- | --- |
| Partition | 哪些节点组成一个可提交资源池 |
| Account | 资源使用归属哪个组织、项目或成本中心 |
| Association | User、Account、Cluster、Partition 的授权关系 |
| QOS | 优先级、并发、时长和资源上限等策略 |
| TRES | 可追踪/记账资源，例如 CPU、Mem、Node、GRES/gpu |
| GRES | 节点上的通用可消费设备，例如 GPU |

Partition 不是租户，QOS 也不是物理节点池。一个 Job 的准入结果由这些对象和请求共同决定。

## 2. GPU GRES

GPU 通常在 `gres.conf` 中按 Type 和设备文件描述，`AutoDetect` 可辅助发现。必须验证：

- 配置数量等于实际设备数量；
- Type 命名稳定且能表达型号或能力；
- File 顺序与 CUDA 可见设备映射一致；
- MIG 等切分模式由目标 Slurm/NVIDIA 版本支持；
- 节点启动后没有 GRES mismatch 导致 Drain。

```bash
scontrol show node <node>
sinfo -o '%N %G %t %E'
srun --nodes=1 --gres=gpu:1 nvidia-smi -L
```

## 3. 请求语义

常见请求包括每 Job、每 Node、每 Task 的 GPU 数。最重要的是让 Task 数、每 Task CPU、内存和 GPU 的关系明确：

```text
总Task = 节点数 × 每节点Task
总GPU = 节点数 × 每节点GPU
每Task GPU = 总GPU / 总Task（仅在设计为一进程一卡时）
```

如果启动 8 个本地 Rank 却只请求 4 张 GPU，环境变量和 cgroup 可能只暴露 4 个设备，训练会冲突或失败。

## 4. TRES 与记账

TRES 用于请求、限制和记录资源。`AllocTRES` 表示分配量，不等于实际使用量；GPU 利用率、显存和功耗仍需 DCGM 等遥测。

使用 `sacct` 查看：

```bash
sacct -j <jobid> --format=JobID,State,Elapsed,AllocTRES,ReqTRES,ExitCode
squeue -j <jobid> -o '%.18i %.9P %.20j %.8u %.2t %.10M %.6D %R'
```

## 5. QOS 与边界

QOS 可控制最大运行作业、最大提交数、Wall Time、每用户/Account TRES 和优先级，也可参与 Preemption。限制层级叠加时，以最严格的有效约束为准。

排查 Pending 时查看 `Reason`，再检查 Association、QOS、Partition 和 TRES；不要盲目提高优先级，因为请求可能根本不满足任何节点形状。

## 6. GPU 型号与 Feature

GRES Type 用于申请 GPU 类型，Feature/Constraint 可表达 CPU、NIC、NVLink 域、机架等其他属性。不要把所有拓扑编码进一个超长 GPU Type；应让硬件型号、网络能力和故障域分别成为可查询维度。

## 7. 设计检查

- 默认 QOS 不允许单用户占满整个生产集群；
- Debug Partition 限时、限卡但启动快；
- 长训练和交互调试使用不同限制；
- Account 层能汇总项目资源；
- GPU 型号命名与 CMDB、监控一致；
- `sacct` 能还原每个任务申请和实际退出结果。

参考：[Slurm GRES](https://slurm.schedmd.com/gres.html)、[Trackable Resources](https://slurm.schedmd.com/tres.html)、[QOS](https://slurm.schedmd.com/qos.html)。
