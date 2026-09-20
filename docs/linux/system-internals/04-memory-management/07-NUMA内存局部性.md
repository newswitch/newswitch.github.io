---
title: "NUMA 内存局部性：CPU、内存、PCIe 设备之间的距离"
sidebar_label: "07. NUMA 内存局部性"
sidebar_position: 7
description: "解释 NUMA Node、First Touch、远端内存、自动平衡、CPU/内存绑定以及 GPU/NIC/NVMe 局部性。"
tags: [Linux, NUMA, First Touch, CPU Affinity, PCIe]
---

# NUMA 内存局部性：CPU、内存、PCIe 设备之间的距离

NUMA 系统中所有 CPU 通常都能访问全部系统内存，但访问本地内存和经 Socket 互连访问远端内存的延迟、带宽和互连成本不同。NUMA 是性能距离，不是默认的访问禁止边界。

## 1. 一个双路模型

```text
NUMA Node 0                         NUMA Node 1
CPU Socket 0 ─ 本地内存 0          CPU Socket 1 ─ 本地内存 1
      │                                   │
      ├─ PCIe：GPU0/NIC0/NVMe0            ├─ PCIe：GPU1/NIC1/NVMe1
      └──────── Socket Interconnect ───────┘
```

CPU0 访问内存1不需要“由 CPU1 执行复制”，请求可通过处理器互连到远端内存控制器；但会占用互连并具有不同延迟。设备到远端内存的 DMA 路径同样受主板拓扑和 IOMMU 影响。

## 2. First Touch

Linux 默认策略下，匿名页常在第一次真正触页的 CPU 所在 Node 分配，而不是 malloc 调用时决定。这使并行初始化方式直接影响页面分布：

- 主线程在 Node0 清零全部数组，随后 Node1 线程访问，会形成远端访问。
- 各工作线程在将来运行的 CPU 上初始化自己的分片，更可能获得本地页。

这也是“先分配再绑核”和“先绑核再触页”结果可能不同的原因。

## 3. NUMA Policy

常见策略包括默认、本地优先、绑定指定 Node、跨 Node interleave、preferred 等。策略既可作用于进程，也可作用于一段内存映射；cpuset 还会限制允许的 memory nodes。

```bash
numactl --hardware
numactl --show
taskset -pc <PID>
grep -E 'Cpus_allowed_list|Mems_allowed_list' /proc/<PID>/status
head -20 /proc/<PID>/numa_maps
```

绑 CPU 不自动等于绑定内存，必须同时检查 `Mems_allowed_list` 和页面实际分布。

## 4. 自动 NUMA 平衡

内核可以通过采样访问和 NUMA hinting fault 识别远端访问，再迁移页面或任务以改善局部性。它有扫描和迁移成本，也可能与应用自身绑核、JVM/数据库策略冲突。

不能看到 `numa_miss` 就直接关闭自动平衡；先确认工作集、任务迁移、设备拓扑和业务效果。

## 5. 观察统计

```bash
numastat
numastat -p <PID>
cat /sys/devices/system/node/node*/meminfo
lscpu -e=CPU,NODE,SOCKET,CORE,ONLINE
```

示例概念：

```text
                           Node 0       Node 1
Numa_Hit                 9123456      8876543
Numa_Miss                    120          980
Other_Node                    980          120
```

这些是累计计数，需采样增量。不同内核字段含义和统计实现可能变化，应用级远端访问最好结合硬件 PMU 和基准验证。

## 6. GPU/NIC/NVMe 的局部性

一个设备通常挂在某个 CPU Socket 的 PCIe Root Complex 下。CPU 线程、主机内存、GPU 和 NIC 位于同一 NUMA Node，往往能减少跨 Socket 路径；但 GPU 间可能另有 NVLink/NVSwitch，NIC 也可能通过 GPUDirect RDMA 访问设备内存，真实路径必须结合拓扑。

优化顺序：

1. 读 `lspci -tv`、`nvidia-smi topo -m`、`lstopo` 等确认拓扑。
2. 识别数据真正生产和消费的位置。
3. 同时规划 CPU、内存、IRQ、NIC/GPU 亲和性。
4. 对比吞吐、尾延迟、远端访问和互连带宽。

## 7. 练习与答案

**问题：任务在 Node0 CPU 上运行，内存一定来自 Node0 吗？**

答案：不一定。页面可能由其他 CPU 首次触页、被共享、被迁移，或受 mempolicy/cpuset 限制。

**问题：不同 NUMA Node 之间传数据是否必须由另一颗 CPU 执行复制？**

答案：不是。CPU 或设备可通过 Socket 互连访问远端内存控制器；远端 CPU 不必运行一段“转发代码”，但互连、缓存一致性和内存控制器会参与。

下一篇：[cgroup 内存与 OOM](./08-cgroup内存与OOM.md)
