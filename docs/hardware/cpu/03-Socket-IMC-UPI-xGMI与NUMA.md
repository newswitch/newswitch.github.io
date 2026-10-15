---
title: "Socket、IMC、UPI、xGMI 与 NUMA"
sidebar_label: "03. Socket 互联与 NUMA"
sidebar_position: 3
description: "理解多路服务器的 CPU Socket、内存控制器、Socket 互联、NUMA 距离、PCIe 归属与亲和性。"
tags: [CPU Socket, IMC, UPI, xGMI, NUMA, 亲和性]
---

# Socket、IMC、UPI、xGMI 与 NUMA

NUMA 不是 Linux 凭空创造的软件分区，而是硬件拓扑的抽象：每个 CPU Socket/Die 更接近一部分内存和 I/O，访问其他域需要经过互联。

## 1. 从 Socket 到 NUMA Node

```text
Socket 0
├── Core / LLC Slice
├── IMC → DDR Channel → DIMM
└── PCIe Root → NIC/GPU/NVMe

Socket 1
├── Core / LLC Slice
├── IMC → DDR Channel → DIMM
└── PCIe Root → NIC/GPU/NVMe

Socket 0 ═══ UPI/xGMI/Coherent Link ═══ Socket 1
```

一个 Socket 也可能包含多个 Compute Die/Chiplet，并向 OS 暴露多个 NUMA Node。不能简单假设“一颗物理 CPU = 一个 NUMA Node”。

## 2. IMC 与内存归属

Integrated Memory Controller 直接控制 DDR Channel。某个物理页由哪个 IMC 管理，就决定其 NUMA Node。

Local Access：

```text
CPU0 Core → CPU0 Fabric → CPU0 IMC → CPU0 DIMM
```

Remote Access：

```text
CPU0 Core → CPU0 Fabric → Socket Link → CPU1 IMC → CPU1 DIMM
```

远端访问增加 Hop、延迟和共享互联流量，但数据仍由硬件内存系统响应，不是由 CPU1 上某个普通 Core 执行复制程序。

## 3. UPI 与 xGMI

不同厂商和代际使用不同 Socket/Die 互联。它们承担：

- Cache Coherency Message；
- Remote Memory Request/Response；
- 部分跨 Socket I/O 访问；
- 中断和平台控制流量。

互联有 Lane/Link 数量、方向带宽和拓扑限制。双路通常直接相连，多路服务器可能形成 Ring、Mesh 或更复杂路径，NUMA Distance 不再只有本地/远端两档。

## 4. PCIe 设备 NUMA 归属

设备连接哪个 Root Complex，就更接近哪个 NUMA Node：

```bash
cat /sys/bus/pci/devices/0000:3b:00.0/numa_node
cat /sys/class/net/eth0/device/numa_node
```

返回 `-1` 可能表示固件/内核没有提供明确归属，不代表设备没有物理路径。应结合 `lspci -tv`、主板图和 CPU Affinity。

## 5. First-touch 内存分配

Linux 常按首次实际写入页面的 CPU 所在 Node 分配物理内存：

```text
主线程在 Node0 初始化全部 Buffer
→ 工作线程分散到 Node0/Node1
→ Node1 线程大量访问 Node0 Remote Memory
```

并行初始化、正确绑核和 Memory Policy 能让页面靠近消费者。仅在程序启动后移动线程，不会自动移动已分配全部内存。

## 6. Interleave 与 Bind

```bash
numactl --hardware
numactl --cpunodebind=0 --membind=0 <command>
numactl --interleave=all <command>
```

- Bind：把线程和内存限制在指定 Node，局部性强但可能容量不足；
- Interleave：跨 Node 轮转分配，适合共享带宽型负载，但单次访问可能远端；
- Preferred：优先某 Node，不足时允许回退。

策略取决于线程模型、内存容量、设备归属和故障容忍，不能统一使用 `--interleave=all`。

## 7. IRQ 与 Queue 亲和性

NIC/NVMe 的 MSI-X Queue 应尽量由设备本地 CPU 处理，相关应用和 Buffer 也应靠近同一 Node：

```text
NIC Queue（Node0）
→ IRQ CPU（Node0）
→ Buffer（Node0 Memory）
→ Worker（Node0 CPU）
```

若 IRQ 在 Node0、应用在 Node1、Buffer 又在 Node1，报文可能多次跨 Socket。`irqbalance` 的默认结果不一定适合专用高性能服务。

## 8. GPU/NIC/NVMe 亲和性

AI 服务器常希望：

- CPU Worker 靠近目标 GPU；
- DataLoader 内存靠近 GPU Root；
- RDMA NIC 与 GPU 在同 Root/Switch 或至少同 Socket；
- 本地 NVMe Cache 与消费 GPU/CPU 靠近。

同 NUMA 只是第一步，Peer-to-Peer 还要继续检查 PCIe Switch、ACS、IOMMU 和驱动支持。

## 9. NUMA Balancing

Linux Auto NUMA Balancing 通过采样访问并迁移 Page/Task 改善局部性，适合部分通用负载。对于显式绑核、Huge Page、Pinned Memory、设备 DMA 和延迟敏感程序，它可能无效或引入抖动。

是否开启要依据 Page Migration、Remote Access 和业务延迟实验，不应照搬数据库或 AI 框架的单一建议。

## 10. 观测

```bash
lscpu -e=CPU,CORE,SOCKET,NODE,CACHE
numactl -H
numastat -p <pid>
cat /proc/<pid>/numa_maps
```

进一步使用平台 PMU 观察本地/远端内存带宽和 Socket Link 利用率。只看 `numastat` 的累计页数，无法解释某个时间窗口的带宽瓶颈。

## 11. 常见误区

| 误区 | 正确认识 |
| --- | --- |
| 同 NUMA 就不经过 CPU | 数据仍经过 Root/Fabric/IMC，只是路径更本地 |
| 跨 NUMA 由另一个 CPU Core 软件复制 | 通常由硬件一致性和内存控制器完成 |
| NUMA Node 等于 Socket | Chiplet/平台可一 Socket 多 Node |
| 绑核就解决 NUMA | 还要绑定/迁移内存、IRQ 和设备 Queue |
| Remote Memory 一定很慢 | 影响取决于访问模式、互联和是否饱和 |

## 12. 练习与答案

**问题：进程线程全在 Node0，但内存大量位于 Node1，可能怎样产生？**

答案：内存可能由先前位于 Node1 的线程 First-touch、共享内存创建者分配、策略 Interleave，或线程迁移后未迁移页面。

延伸阅读：

- [NUMA 内存局部性](../../linux/system-internals/04-memory-management/07-NUMA内存局部性.md)
- [GPU 服务器硬件拓扑与 NUMA](../../gpu/pcie-numa/04-GPU服务器硬件拓扑与NUMA.md)
