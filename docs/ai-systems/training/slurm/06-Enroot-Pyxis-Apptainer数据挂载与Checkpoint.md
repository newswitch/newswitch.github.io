---
title: "Slurm 中的 Enroot、Pyxis、Apptainer、数据挂载与 Checkpoint"
sidebar_label: "06. 容器、数据与 Checkpoint"
sidebar_position: 6
description: "理解 HPC 容器与 Slurm Step 集成、镜像缓存、设备和挂载边界，并设计可恢复训练数据路径。"
tags: [Slurm, Enroot, Pyxis, Apptainer, Checkpoint]
---

# Slurm 中的 Enroot、Pyxis、Apptainer、数据挂载与 Checkpoint

## 1. HPC 容器与 Kubernetes Pod 不同

Enroot 将容器镜像转换为适合 HPC 的无守护进程运行环境，Pyxis 通过 Slurm SPANK Plugin 把容器参数接入 `srun`。Apptainer 同样面向 HPC，支持镜像和宿主资源集成。最终 Task 仍由 slurmstepd 管理。

```text
sbatch/srun
→ SPANK/Pyxis解析容器参数
→ 准备或复用镜像RootFS
→ 挂载代码/数据/Checkpoint
→ 注入GPU/RDMA设备与动态库
→ 在Slurm cgroup中启动Task
```

## 2. 镜像可复现

生产作业使用不可变 Digest，不使用会漂移的 Tag。还要记录：

- 基础 OS、Python、PyTorch；
- CUDA/CANN 用户态库；
- NCCL/HCCL、MPI/UCX；
- 应用 Git Revision；
- 宿主 Driver 和 Kernel 兼容范围。

容器不会携带可直接替代宿主 GPU Kernel Driver 的完整内核栈。

## 3. 镜像缓存风暴

大量节点同时转换或拉取大镜像会压垮 Registry 和共享文件系统。可采用：

- 节点预热和不可变缓存键；
- 分层 Registry/镜像代理；
- 并发限制和随机抖动；
- 内容校验和与损坏缓存清理；
- 统计 Image Prepare Time 与命中率。

## 4. 挂载边界

只挂载训练需要的路径。避免把宿主 `/`、Docker Socket、SSH Key 或设备目录整体暴露。数据集用只读；输出和 Checkpoint 使用独立目录；临时缓存放本地 NVMe 时明确配额与清理。

容器内 UID/GID 必须能访问共享存储。Root Squash、ACL、Umask 和不同节点用户映射不一致会导致只有部分 Rank 无法写入。

## 5. Checkpoint 设计

```text
各Rank写临时Shard
→ 等待全部Shard和Metadata完成
→ 校验大小/Checksum
→ Rank0或协调器发布完成标志
→ 更新latest指针
```

恢复只读取带完成标志的版本，不能把目录存在等同于 Checkpoint 完整。抢占前的 Signal 和 Time Limit 应给保存动作留下预算，但不能假定任何时刻都能及时写完。

## 6. 数据路径

训练数据可从共享文件系统直接读取，也可 Stage 到节点本地 NVMe。后者要解决：缓存键、容量、并发下载、校验、驱逐和节点更换。不同 Rank 重复读取同一对象时，协调下载比所有进程各自回源更稳定。

## 7. 排障

```text
容器无法启动 → SPANK/Runtime/镜像/权限
GPU不可见 → GRES/cgroup/设备注入/Driver
RDMA退回Socket → 设备与库挂载/UCX/NCCL选择
只有部分Rank I/O失败 → UID/GID/挂载/节点缓存
恢复失败 → Shard/Metadata/World Size/完成标志
```

## 8. 容器生命周期不改变资源所有权

镜像规定用户态文件内容；容器运行时规定命名空间、挂载和启动行为；Slurm 决定 Allocation 并约束 Task。三者必须一致。容器里有 `libcuda.so`，不代表宿主内核驱动兼容；镜像里有 RDMA 库，也不代表当前 Task 获得了 HCA 访问权限。

一次启动可按五份事实检查：镜像 Digest、转换后 RootFS、实际挂载、进程 cgroup、设备 UUID。共享缓存中的同名镜像目录不能作为可靠版本标识；转换中断后应识别未完成状态，不能让其他节点读取半份 RootFS。

## 9. Checkpoint 是发布协议

假设训练有 4 个 Rank，每个写一个 Shard。前三个写完而第四个失败时，目录已存在且有大量字节，但版本不完整。恢复端需要可验证的 Manifest，包含四份预期分片、大小或校验值及训练元数据；只有版本完成条件满足后，才能发布到恢复候选列表。

文件 `write` 返回、数据进入页缓存、数据按存储承诺持久化，以及恢复端可读，是不同阶段。同文件系统的原子 Rename 能解决命名可见性问题，但不单独承诺掉电后的持久性；对象存储也不能照搬目录 Rename，通常使用不可变分片与最后发布的元数据对象。

抢占信号给保存过程一个机会，不保证所有 Rank 都有足够时间完成。硬故障可能没有预告，因此周期 Checkpoint 和发布一致性仍是基本条件，不能只依赖“退出前保存”。

## 10. 保存频率的成本

教学模型中，每次保存耗时 C、每隔 I 分钟保存一次，忽略重叠时保存开销占比约为 `C / I`；若故障均匀落在间隔内，平均未保存工作约为 `I / 2`。缩短 I 会降低重算量，却增加存储负载与正常开销。

例如 C 为 2 分钟，I 为 20 分钟，保存开销约 10%，平均未保存工作约 10 分钟；I 改为 60 分钟，对应约 3.3% 和 30 分钟。这里不是实际集群性能结论：异步保存、故障分布、保存失败和恢复成本都会改变模型。应先理解这种取舍，再选择间隔。

## 11. 掌握检查

若校验通过但新 World Size 无法恢复，说明字节完整性不等于训练状态兼容；还需要框架支持状态重分片。若容器重启后无法读取旧 Checkpoint，先核对路径、UID/GID、挂载与版本，再判断是否数据损坏。

参考：[Pyxis](https://github.com/NVIDIA/pyxis)、[Enroot](https://github.com/NVIDIA/enroot)、[Apptainer User Guide](https://apptainer.org/docs/user/latest/)、[PyTorch Distributed Checkpoint](https://docs.pytorch.org/docs/stable/distributed.checkpoint.html)。
