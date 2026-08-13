---
title: numactl 命令详解：控制 NUMA CPU 与内存放置策略
sidebar_position: 14
description: 完整讲解 numactl 的全部参数、节点表达式、CPU 绑定与内存策略区别、cpuset 相对语义、shared memory 持久策略，以及 GPU/NIC 同 NUMA 优化。
tags: [Linux, numactl, NUMA, CPU亲和性, 内存性能]
---

# `numactl` 命令详解：控制 NUMA CPU 与内存放置策略

`numactl` 为新进程设置 CPU 可运行范围和 NUMA memory policy，或给 SysV shared memory、tmpfs/hugetlbfs 文件设置持久策略。它控制的是 Linux CPU/内存放置，不会改变 GPU 显存归属，也不会替代 cgroup cpuset。

## 1. 先看硬件，再谈绑定

```bash
numactl --hardware --cpu-compress
numactl --show
```

`--hardware/-H` 显示 node、CPU、内存容量/空闲量和距离矩阵；`--cpu-compress` 把 CPU 列压缩为范围。距离是固件/内核抽象成本，不是纳秒，也不保证所有设备路径对称。

## 2. 运行命令的全部策略参数

```text
numactl [POLICY...] [--] COMMAND [ARG...]
```

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a` | `--all` | 不受当前 cpuset 感知限制，允许后续表达式使用全部可能 CPU/node；容器中通常无权突破 cgroup |
| `-i NODES` | `--interleave=NODES` | 新页按节点 round-robin 交错；目标缺页时可回退 |
| `-w NODES` | `--weighted-interleave=NODES` | 按 sysfs 中各 node 权重交错；需新内核支持 |
| `-m NODES` | `--membind=NODES` | 只从指定节点分配，内存不足时分配失败，不回退 |
| `-p NODE` | `--preferred=NODE` | 首选单一节点，不足时允许回退 |
| `-P NODES` | `--preferred-many=NODES` | 首选多个节点，并倾向其中距离最近者 |
| `-l` | `--localalloc` | 优先在发起 page fault 的当前 node 分配，可回退 |
| `-N NODES` | `--cpunodebind=NODES` | 只在指定 NUMA node 所含 CPU 上运行 |
| `-C CPUS` | `--physcpubind=CPUS` | 按逻辑 CPU ID 精确设置 CPU affinity |
| `-b` | `--balancing` | 与 `--membind` 配合允许 kernel NUMA balancing；其他策略下忽略 |
| `-s` | `--show` | 显示当前进程 NUMA policy |
| `-H` | `--hardware` | 显示系统 NUMA inventory |
| 无 | `--cpu-compress` | `--hardware` 的 CPU 范围压缩显示 |
| 无 | `--version` | 显示 numactl 版本 |

旧 `--cpubind` 以 node 而非 CPU 为参数，已经弃用；改用 `--cpunodebind` 或 `--physcpubind`。

## 3. node 与 CPU 表达式

```text
0,2-3          绝对编号
+0-1           相对当前 cpuset 允许集合
!0             允许集合中除 node/CPU 0 之外
!+0            允许集合中排除相对编号 0
all            当前 cpuset 中全部
same           重用前一 nodemask（node policy）
```

node 还可按设备定位：

```text
netdev:eth0
ip:10.0.0.10
file:/data/model
block:nvme0n1
pci:0000:3b:00.0
```

```bash
numactl --cpunodebind=netdev:eth0 --membind=netdev:eth0 -- ./server
numactl --cpunodebind=pci:0000:3b:00.0 --preferred=pci:0000:3b:00.0 -- ./worker
```

设备的 `numa_node` 可能为 `-1`（未知/无特定节点），此时不能臆测为 node 0。

## 4. CPU 绑定与内存绑定是两件事

```bash
numactl --cpunodebind=0 --membind=0 -- ./benchmark
```

- `--cpunodebind`/`--physcpubind` 限制线程在哪些 CPU 执行；
- memory policy 决定**未来 page fault** 在哪里分配；
- 已经 fault-in 的页通常不会因启动 `numactl` 自动迁移；
- 线程若先在错误节点初始化内存，再换 CPU，仍可能大量远端访问。

验证必须看实际驻留：

```bash
numastat -p PID
grep -E 'Cpus_allowed_list|Mems_allowed_list' /proc/PID/status
cat /proc/PID/numa_maps | head
```

## 5. 策略选择

| 目标 | 常用策略 | 代价/风险 |
|---|---|---|
| 单 socket 延迟敏感服务 | CPU 同 node + `--preferred`/`--localalloc` | 容量不足会回退，延迟可变 |
| 必须阻止远端页 | `--membind` | 可能直接 OOM/分配失败，即使其他 node 有空闲 |
| 大容量吞吐型内存 | `--interleave=all` | 增加跨互联流量，未必适合 latency workload |
| CXL/异构内存按比例 | `--weighted-interleave` | 依赖内核与权重配置，需实测 |
| GPU/NIC 数据路径 | CPU、内存、GPU、NIC 同 locality | 设备 P2P/IOMMU/PCIe 拓扑仍要单独核对 |

不要在没有 A/B benchmark 和尾延迟数据时把“绑到同一 node”直接定义为优化。

## 6. shared memory/file 持久策略全部参数

```text
numactl [SHM OPTIONS] (--shm KEYFILE | --shmid ID | --file FILE) POLICY
```

| 参数 | 含义 |
|---|---|
| `--huge` | 创建 SysV segment 时用 huge pages；必须在 `--shm/--shmid` 前 |
| `--offset OFFSET` | 策略区域起始偏移，支持 k/m/g 单位 |
| `--shmmode MODE` | 新建 SysV segment 的八进制权限，须在目标参数前 |
| `--length LENGTH` | 策略范围长度；新建 segment 时必需 |
| `--strict` | 已 fault 页与新策略冲突时报错 |
| `--shmid ID` | 使用/创建数值 SysV shm ID |
| `--shm KEYFILE` | 通过 `ftok` key file 使用/创建 SysV shm |
| `--file FILE` | 给 tmpfs/hugetlbfs 文件设置策略 |
| `--touch` | 主动触碰页，让策略尽早实际分配 |
| `--dump` | 显示指定范围策略 |
| `--dump-nodes` | 显示范围内逐页 node，输出很大 |

这些参数**顺序有意义**。文件系统必须支持相应 policy；hugetlbfs 还有实现限制。

## 7. 容器与 Kubernetes 边界

容器内看到的 allowed CPU/mem node 由 cgroup cpuset 限制。使用绝对 host CPU ID 的脚本容易在不同 Pod 失效，优先相对 `+N` 并先检查：

```bash
grep -E 'Cpus_allowed_list|Mems_allowed_list' /proc/self/status
numactl --show
```

Kubernetes CPU Manager 的 exclusive CPU、Topology Manager、device NUMA affinity 与 Pod QoS 共同决定可用拓扑；进程内 `numactl` 只能在允许集合内进一步收窄。

## 8. 官方参考

- [numactl：numactl(8)](https://man7.org/linux/man-pages/man8/numactl.8.html)
- [Linux 内核：NUMA memory policy](https://docs.kernel.org/admin-guide/mm/numa_memory_policy.html)

下一篇：[numastat 命令详解](./15-numastat命令详解.md)。
