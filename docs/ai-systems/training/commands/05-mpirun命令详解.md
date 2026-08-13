---
title: "mpirun 与 MPI 作业诊断"
sidebar_position: 5
description: "掌握 Open MPI mpirun 的进程映射、绑定、hostfile、MCA参数、输出治理，以及与NCCL和Kubernetes的边界。"
tags: [MPI, mpirun, Open MPI, HPC, NCCL, 分布式训练]
---

# mpirun 与 MPI 作业诊断

MPI常用于HPC训练、Horovod、MPI Operator以及启动多节点基准。`mpirun` 创建MPI进程世界并负责映射、绑定、环境传播和启动；NCCL负责GPU collective时，两者可能同时存在但职责不同。

## 1. 确认实现与版本 `[R]`

```bash
type -a mpirun mpiexec
mpirun --version
ompi_info --version
ompi_info --all | less
```

MPI实现之间参数不兼容。本文以Open MPI概念为主，运行前必须确认实际二进制、版本和编译能力；不要把MPICH、Intel MPI或厂商MPI参数直接套用。

## 2. 本地最小运行 `[A]`

```bash
mpirun -np 4 hostname
mpirun -np 4 --tag-output bash -lc 'echo rank=$OMPI_COMM_WORLD_RANK local=$OMPI_COMM_WORLD_LOCAL_RANK host=$(hostname)'
```

常见环境变量：`OMPI_COMM_WORLD_RANK`、`SIZE`、`LOCAL_RANK`、`LOCAL_SIZE`。不同MPI实现名称不同，应用代码优先使用MPI API。

## 3. 主机与进程映射 `[A]`

```text
worker-0 slots=8
worker-1 slots=8
```

```bash
mpirun -np 16 --hostfile hosts \
  --map-by ppr:8:node \
  --bind-to core \
  --report-bindings \
  ./app
```

核心参数族：

| 参数 | 含义 |
|---|---|
| `-np/-n` | 总进程数 |
| `--host`、`--hostfile` | 目标主机与slot来源 |
| `--map-by` | rank如何分布到节点、socket、NUMA或PE |
| `--rank-by` | rank编号顺序 |
| `--bind-to` | 绑定core、hwthread、socket、NUMA或不绑定 |
| `--report-bindings` | 输出实际CPU绑定，排查性能必开 |
| `--display-map`、`--display-allocation` | 输出映射和资源分配 |
| `--oversubscribe` | 允许进程数超过slot，生产训练慎用 |
| `-x NAME[=VALUE]` | 向远端传播环境变量，避免传递Secret |
| `--mca KEY VALUE` | 设置MCA参数，版本和组件相关 |
| `--tag-output`、`--output-filename` | 标记或分文件保存rank输出 |

## 4. CPU/NUMA/GPU绑定

CPU映射会影响数据预处理、NCCL代理线程和PCIe本地性。先看拓扑：

```bash
lscpu
numactl --hardware
lstopo-no-graphics
nvidia-smi topo -m
```

不要只设置 `--bind-to core` 就假定GPU本地。应用还需根据local rank选择GPU，节点rank顺序与 `CUDA_VISIBLE_DEVICES` 必须一致。通过日志记录rank、CPU集合、NUMA、GPU UUID和NIC。

## 5. 网络与MCA诊断

```bash
ompi_info --param pml all
ompi_info --param btl all
ompi_info --param oob all
mpirun --mca pml_base_verbose 20 -np 2 ./app
```

组件体系会随Open MPI版本和UCX集成变化。MCA verbose日志非常大，只在小规模复现。若应用的GPU通信由NCCL完成，MPI网络选择仍可能影响启动、控制面或CPU消息，但不等于NCCL数据面选择。

## 6. 容器与Kubernetes边界

MPI Operator通常创建Launcher与Worker Pod并准备SSH/服务发现。应在Launcher内按Operator生成的hostfile运行，不要越过Kubernetes资源限制。核对：

- Pod请求的CPU/GPU和 `slots` 是否一致。
- 容器共享内存、memlock、IPC和RDMA设备是否可用。
- SSH密钥、known_hosts、Service DNS和NetworkPolicy。
- Open MPI、UCX、NCCL和驱动用户态库在所有Pod中一致。

## 7. 故障矩阵

| 现象 | 首要检查 |
|---|---|
| 无法启动远端进程 | SSH/PMIx/PRRTE日志、DNS、hostfile、权限和可执行路径 |
| rank数量或分布错误 | allocation、slot、`-np`、map-by和调度器注入参数 |
| 单节点快、多节点慢 | CPU/NUMA/GPU/NIC绑定、UCX/NCCL网络、MTU和拓扑 |
| 某rank退出后整体挂住 | 第一个失败rank、MPI错误处理、launcher信号传播 |
| 输出无法关联 | 开启tag output或每rank日志，文件名加入job ID和rank |
| 容器内RDMA不可用 | 设备、权限、verbs库、GID、memlock与CNI/RDMA配置 |

## 掌握标准

能画出allocation、mapping、ranking、binding四个阶段；能证明每个rank的CPU/GPU/NIC本地性；能区分MPI启动控制面与NCCL GPU数据面；能在Operator受管集群中保持单一控制源。

## 官方资料

- [Open MPI mpirun manual](https://docs.open-mpi.org/en/main/man-openmpi/man1/mpirun.1.html)
- [Open MPI documentation](https://docs.open-mpi.org/)
