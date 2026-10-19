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

## 7. 一张 GPU 的四种身份

教学例子：作业获得宿主物理 GPU 3，其 UUID 为 `GPU-example`。运行时只向容器暴露这张设备后，应用通常把唯一可见 GPU 编为 `cuda:0`。这时物理索引 3、UUID、PCI BDF、进程逻辑编号 0 都可以指向同一设备，但它们不是可随意互换的标识。

```text
全局 Rank 5 → 节点 B 的本地 Rank 1
→ 分配的 GPU UUID → 宿主 PCI BDF
→ 容器可见设备集合 → 应用 cuda 编号
```

`CUDA_VISIBLE_DEVICES` 影响 CUDA 的可见集合和编号，不等于单独建立内核访问控制。若设备节点被额外暴露、容器有高权限或 cgroup 没有约束，仅靠环境变量不能证明租户隔离。

## 8. cgroup v2 不照搬 v1 文件名

CPUSet 限定可运行 CPU 与内存节点，内存控制器限制作业主机内存；设备访问在 cgroup v2 中常通过附加的 BPF 设备策略实现，不能因为找不到 v1 的 `devices.allow` 就判断没有隔离。Slurm 插件配置、systemd 委派与内核支持必须一起检查。

```text
期望 CPU 集合 → 有效 CPU 集合 → Task 实际运行位置
期望内存节点 → NUMA 分配策略 → 已分配页面的位置
期望 GPU 集合 → 内核设备权限 → CUDA 实际枚举
```

这三条验证链不能相互代替。CPU 绑定不会自动把已经分配的所有页面搬到目标 NUMA，也不自动令 NCCL 选择最近 HCA；还需要内存策略、首次触页位置和通信库拓扑选择共同成立。

## 9. 从资源请求推导并发

假设每节点启动 4 个 Rank，每 Rank 分配 8 个 CPU，总分配是 32 CPU。若每 Rank 又启动 8 个 DataLoader Worker，并让每个 Worker 的数学库创建 8 个线程，仅这部分潜在线程就达到 256，远大于分配 CPU。线程数不是 CPU 预算，GPU 低利用率可能来自节点内过度并发而非缺卡。

应先给主进程、DataLoader、通信进度及线程库列出预算，再用有效 cpuset、线程数和 CPU Throttling 验证。SMT 逻辑 CPU 与物理 Core 的关系还取决于分配策略，不能仅凭“32 CPU”推断为 32 个独立物理核。

## 10. 掌握检查

一个作业显示 `cuda:0`，另一个也显示 `cuda:0`，能否断言冲突？不能，需要比较 UUID/BDF 和实际权限。两个逻辑编号相同可以对应不同物理卡；两个进程物理索引不同也可能因容器重编号而被误读。

参考：[Slurm cgroup v2](https://slurm.schedmd.com/cgroup_v2.html)、[CPU Management User Guide](https://slurm.schedmd.com/cpu_management.html)、[Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)。
