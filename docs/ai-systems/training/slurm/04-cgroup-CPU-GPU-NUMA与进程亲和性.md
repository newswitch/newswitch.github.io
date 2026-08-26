---
title: "Slurm cgroup、CPU、GPU、NUMA 与进程亲和性"
sidebar_label: "04. cgroup 与进程亲和性"
sidebar_position: 4
description: "理解 Slurm 如何使用 cgroup 限制资源，并让训练 Rank 与 CPU、内存、GPU 和 NIC 拓扑匹配。"
tags: [Slurm, cgroup, NUMA, GPU, 亲和性]
---

# Slurm cgroup、CPU、GPU、NUMA 与进程亲和性

## 1. 分配与隔离是两件事

Scheduler 告诉作业可以使用哪些资源，cgroup 插件负责在节点上限制 CPU、内存和设备访问。仅配置 GRES 而未正确约束设备，作业可能看见或使用未分配 GPU。

```text
Job Allocation
→ slurmd/slurmstepd
→ task/cgroup与proctrack/cgroup
→ CPUSet、Memory、Device约束
→ 环境变量与CUDA设备编号
```

目标版本使用 cgroup v1 还是 v2、Slurm 插件字段如何配置，应以实际 Slurm 文档为准。

## 2. CPU 分配

训练进程不仅使用 GPU，还需要 CPU 完成 Tokenization、DataLoader、网络协议和 Kernel Launch。常见参数：

- `--ntasks`：Task 总数；
- `--ntasks-per-node`：每节点 Task；
- `--cpus-per-task`：每 Task CPU；
- `--cpu-bind`：CPU 绑定；
- `--mem`/`--mem-per-cpu`：内存请求。

DataLoader Worker 和线程库会消耗额外 CPU。`OMP_NUM_THREADS × 本地Rank数` 不应超过分配 CPU，否则 cgroup 内部过度竞争。

## 3. GPU 映射

Slurm 可能通过 `CUDA_VISIBLE_DEVICES` 重新编号已分配 GPU，因此进程看到的逻辑 `cuda:0` 不一定是宿主机物理索引 0。排障同时记录：

- `SLURM_LOCALID`、`SLURM_PROCID`；
- `CUDA_VISIBLE_DEVICES`；
- GPU UUID；
- PCI BDF；
- cgroup Device Allow List。

不要把 `SLURM_PROCID` 直接当作每节点 GPU Index；Global Rank 和 Local Rank 含义不同。

## 4. NUMA 绑定

理想路径：

```text
Local Rank
→ 同NUMA CPU Core
→ 同NUMA内存
→ 本地PCIe GPU
→ 本地HCA/NIC
```

可使用 `--distribution`、`--cpu-bind`、`--mem-bind` 和应用 Launcher 共同控制。最终用 `numactl -H`、`lstopo`、`nvidia-smi topo -m` 和进程 CPUSet 验证，而不是只相信提交参数。

## 5. 内存与 OOM

Slurm 记录的 Out Of Memory 可能来自 Job cgroup Limit，而不是整机物理内存耗尽。需要区分：

- Linux memcg OOM；
- GPU HBM OOM；
- tmpfs `/dev/shm` 达到限制；
- pinned memory/页缓存增长；
- 节点级 OOM Killer。

检查 Step 日志、Kernel Log、`sacct` MaxRSS 和 GPU 遥测。

## 6. 验收实验

1. 申请一张 GPU，确认看不到其他 GPU；
2. 两个作业同时运行，确认设备互不重叠；
3. 每 GPU 一个 Task，打印 Global/Local Rank、CPUSet、NUMA、UUID；
4. 刻意超过内存限制，确认状态和记账正确；
5. 对比本地与跨 NUMA 的 H2D、RDMA、NCCL 性能。

参考：[Slurm cgroup v2](https://slurm.schedmd.com/cgroup_v2.html)、[CPU Management User Guide](https://slurm.schedmd.com/cpu_management.html)。
