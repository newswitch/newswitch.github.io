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

参考：[Pyxis](https://github.com/NVIDIA/pyxis)、[Enroot](https://github.com/NVIDIA/enroot)、[Apptainer User Guide](https://apptainer.org/docs/user/latest/)。
