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

QOS 可控制最大运行作业、最大提交数、Wall Time、每用户/Account TRES 和优先级，也可参与 Preemption。限制不总是简单取最小值：不同类型按层级优先顺序、Partition 边界和组级约束处理，见下文。

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

## 8. 限制优先顺序与反例

普通层级限制的查找顺序通常为 Partition QOS、Job QOS、User Association、逐层上溯的 Account Association、Cluster Association、Partition。`OverPartQOS` 可以交换前两个 QOS 的优先顺序。对同一字段，先找到的已定义值可能决定生效值，而不是遍历所有层级后统一取最小值。

教学例子：Partition QOS 定义 `MaxJobs=20`，User Association 定义 `MaxJobs=4`、`MaxSubmitJobs=50`，其余相关限制未定义。按照官方层级示例，生效的这两个字段分别是 20 和 50，不是 4 和 50。这并不意味着用户一定能启动 20 个 GPU 作业：资源形状、其他组级限制及节点可用性仍会阻止运行。

`MaxTime/MaxWall`、节点数边界和 `Grp*` 等有特殊规则。组级 GPU 限制控制整个账户树，不能因为某个用户有更宽的限制，就允许其突破组织总额。应按字段逐项写出“来源、覆盖关系、当前用量、是否允许提交、是否允许启动”，不要用一句“越小越严格”代替规则。

## 9. 请求数量不等于可放置形状

假设两个节点各有 4 张 GPU，节点 A 已用 2 张，节点 B 已用 2 张，总空闲为 4。请求“单节点 4 GPU”的 Job 仍不能运行；请求“两个节点各 2 GPU”才可能满足。还要检查每节点 CPU、内存、GPU Type、Feature 和拓扑约束。

GRES 描述可消费设备，TRES 提供统一的请求、限制和记账维度。配置 `gres/gpu=8` 的账户上限不代表已经实施设备隔离。实际设备访问还需要节点侧 cgroup 和运行时配合，见[隔离与亲和性](./04-cgroup-CPU-GPU-NUMA与进程亲和性.md)。

`AllocTRES` 记录分配资源，不是浮点运算量。8 张卡分配 1 小时可以形成 8 GPU 小时的分配占用，但其中可能有下载、编译、通信等待或错误重试。成本归属与计算效率应分别统计。

## 10. 拒绝提交与等待运行

提交校验、关联授权、配额执行和实际调度是不同阶段。必须核对 `AccountingStorageEnforce` 是否启用了目标规则；数据库里存在限制，不自动证明控制器会按预期执行。

一种请求可能被拒绝，另一种可能成功提交后 Pending；`DenyOnLimit`、限制类型和请求是否单独超限会影响结果。Pending Reason 只是当前暴露出的阻碍，不保证列出了所有问题。修复一个原因后可能出现下一项，应重新读取 Job 和有效规则。

## 11. 掌握检查

给定节点 A/B 各空闲 2 GPU、账户尚余 4 GPU、单节点请求 4 GPU，为什么作业等待？组织预算足够，但节点放置不成立。若把账户上限改成 8，问题仍然存在。

再给 Partition QOS 和 User Association 设置不同 MaxJobs，解释有效限制来自哪里；随后加入 Account 的 `GrpTRES`，解释为什么普通字段的覆盖规则不能取消组织总量限制。答案应包含对象关系，而不是只报一个数字。

参考：[Slurm GRES](https://slurm.schedmd.com/gres.html)、[Trackable Resources](https://slurm.schedmd.com/tres.html)、[QOS](https://slurm.schedmd.com/qos.html)、[Resource Limits](https://slurm.schedmd.com/resource_limits.html)。
