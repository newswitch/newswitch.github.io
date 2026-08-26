---
title: "PMI、PMIx、MPI、NCCL、RDMA 与多机训练启动链路"
sidebar_label: "05. 多机训练启动与通信"
sidebar_position: 5
description: "追踪 Slurm Allocation 中 Rank 从 srun、PMIx/MPI 启动到 NCCL 选择 RDMA 网卡的完整控制面和数据面。"
tags: [Slurm, PMI, PMIx, MPI, NCCL, RDMA]
---

# PMI、PMIx、MPI、NCCL、RDMA 与多机训练启动链路

## 1. 四层不要混淆

| 层 | 作用 |
| --- | --- |
| Slurm | 分配节点资源并创建作业 Step |
| PMI/PMIx | 进程管理接口、Rank 信息与 Key-Value 交换 |
| MPI/torchrun | 启动或组织分布式进程 |
| NCCL/HCCL | GPU/NPU 集合通信数据面 |

MPI 可以调用 NCCL 完成 GPU Buffer Collective，也可以使用自身通信路径；PyTorch DDP 可以不经过 MPI，由 `srun` 或 `torchrun` 启动后直接初始化 NCCL。

## 2. 一次 `srun` 路径

```text
srun向slurmctld确认Allocation
→ slurmd在各节点接收Step启动请求
→ slurmstepd创建cgroup和环境
→ PMI/PMIx发布Rank/Endpoint信息
→ 训练进程初始化Process Group
→ NCCL Bootstrap交换地址
→ 选择Socket或IB/RoCE Transport
→ 建立Ring/Tree/Channel
→ 第一轮Collective
```

“任务卡在初始化”要先判断卡在 Step 启动、PMIx、NCCL Bootstrap 还是 RDMA 数据连接。

## 3. Rank 映射

典型环境变量包括 `SLURM_PROCID`、`SLURM_LOCALID`、`SLURM_NODEID` 和 `SLURM_NTASKS`。训练框架还可能使用 `RANK`、`LOCAL_RANK`、`WORLD_SIZE`。Launcher 必须建立唯一且完整的映射。

在每个进程启动早期打印主机名、PID、所有 Rank、GPU UUID、NIC 和版本，可以显著缩短错配排查时间。

## 4. MPI 与 Slurm 集成

MPI 构建时使用的 PMIx/PMI 与 Slurm 可用 Plugin 必须兼容。验证：

```bash
srun --mpi=list
srun --nodes=2 --ntasks-per-node=1 hostname
```

若 `srun` 能启动 hostname，但 MPI 程序失败，继续检查 MPI Runtime、PMIx 和动态库；若连 Step 都不能跨节点启动，先处理 Slurm、Munge、DNS 和端口。

## 5. NCCL 与 RDMA

NCCL Bootstrap 通常需要 IP 网络，数据面可选择共享内存、NVLink、Socket 或 IB/RoCE。检查：

- `NCCL_SOCKET_IFNAME` 是否选择管理网还是训练网；
- HCA 与 GPU 的 PCIe/NUMA 距离；
- GID、RoCE Mode、PFC/ECN 或 IB Partition；
- RDMA Device 是否被 cgroup/容器暴露；
- 防火墙和随机端口范围；
- 所有 Rank 的 NCCL/CUDA/Driver 版本。

## 6. 分层基线

```text
跨节点srun hostname
→ MPI/PMIx hello world
→ TCP iperf3
→ RDMA perftest
→ 单节点nccl-tests
→ 两节点nccl-tests
→ 目标规模nccl-tests
→ 真实训练
```

跳过中间基线会把任何问题都变成“多机训练失败”。

## 7. 首个失败 Rank

一个 Rank 因数据加载或设备错误退出，其他 Rank 可能最终都报告 Collective Timeout。按带时间戳的日志找到最早异常进程，并关联 Slurm Step、Node、GPU UUID 和交换端口；超时 Rank 通常不是根因。

参考：[Slurm MPI Users Guide](https://slurm.schedmd.com/mpi_guide.html)、[NCCL User Guide](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/)。
