---
title: "DPDK EAL、HugePage、VFIO、IOMMU 与 NUMA"
sidebar_label: "02. EAL、HugePage、VFIO 与 NUMA"
sidebar_position: 2
description: "解释 DPDK 如何初始化核心、内存和 PCIe 设备，以及 HugePage、IOVA、VFIO、IOMMU、NUMA 与安全隔离的关系。"
tags: [DPDK, EAL, HugePage, VFIO, IOMMU, IOVA, NUMA]
---

# DPDK EAL、HugePage、VFIO、IOMMU 与 NUMA

EAL（Environment Abstraction Layer）负责在 DPDK 应用启动时建立运行环境：发现 CPU 和 PCIe 设备、选择 lcore、准备 HugePage 内存、建立 IOVA/DMA 映射、加载驱动并初始化日志与多进程资源。

## 1. EAL 在启动阶段做什么

```text
解析 EAL 参数
→ 识别 CPU、NUMA 与 lcore
→ 建立线程并设置 CPU Affinity
→ 发现 HugePage 与内存段
→ 扫描 PCIe Bus 和允许的设备
→ 通过 VFIO 建立设备与 DMA 映射
→ 加载对应 PMD
→ 初始化 Telemetry、日志和多进程共享资源
→ 进入应用自己的参数解析与数据面
```

DPDK 命令中的 `--` 用于分隔两类参数：

```bash
dpdk-testpmd [EAL 参数] -- [testpmd 参数]
```

把 `--rxq` 放在 `--` 前面，EAL 不认识；把 `-l` 放在后面，testpmd 也不认识。

## 2. lcore 不完全等于物理核心

DPDK 文档中的 lcore 是 EAL 管理的逻辑执行单元，通常对应 Linux Logical CPU。启用 SMT 时，同一个物理 Core 可能有两个 Logical CPU，共享部分执行资源。

```bash
lscpu -e=CPU,CORE,SOCKET,NODE,ONLINE
cat /sys/devices/system/cpu/cpu2/topology/thread_siblings_list
```

数据面核心规划要区分：

- Linux CPU 编号；
- 物理 Core；
- SMT Sibling；
- NUMA Node；
- PMD lcore 与控制/服务 lcore。

两个繁忙 PMD 放在同一物理 Core 的两个 SMT Thread 上，通常无法得到两个独立 Core 的能力。

## 3. HugePage 为什么重要

DPDK 用大块、可固定、适合 DMA 映射的内存保存 Mempool、mbuf、Ring 和其他对象。HugePage 的主要作用包括：

- 用更少的页表项覆盖大内存；
- 降低 TLB Miss；
- 便于建立较稳定的大块 DMA 映射；
- 允许多个 DPDK 进程通过 hugetlbfs 文件共享内存。

HugePage 不等于“物理内存连续到任意大小”，也不保证自动 NUMA 本地。要分别查看每个 Node 的页数：

```bash
grep -E 'HugePages|Hugepagesize|Hugetlb' /proc/meminfo
find /sys/devices/system/node -path '*hugepages-*' -name nr_hugepages -print -exec cat {} \;
dpdk-hugepages.py --show
```

当前 DPDK 可以使用 `dpdk-hugepages.py` 管理实验环境：

```bash
sudo dpdk-hugepages.py --setup 2G
```

生产环境应按 Socket 显式规划，避免进程在 Node 0 运行却主要使用 Node 1 的 HugePage。

## 4. VA、PA 与 IOVA

需要区分三个地址：

```text
VA   ：进程访问的虚拟地址
PA   ：DRAM 中的物理地址
IOVA ：设备执行 DMA 时使用的 I/O 虚拟地址
```

启用 IOMMU 时，设备看到的 IOVA 由 IOMMU 映射到物理页。这样可以限制设备只访问授权内存，防止错误或恶意 DMA 覆盖其他进程和内核数据。

DPDK 的 IOVA 模式可能是 PA 或 VA，取决于平台、驱动和启动参数。不要凭地址数值猜测，应查看启动日志：

```text
EAL: Selected IOVA mode 'VA'
```

只有理解目标硬件与 PMD 要求后才应显式指定 `--iova-mode=pa|va`。

## 5. VFIO 做了什么

`vfio-pci` 是 Linux 提供的安全用户态设备访问框架。典型过程：

```text
PCIe Function 从原内核驱动解绑
→ 绑定 vfio-pci
→ 按 IOMMU Group 获得设备所有权
→ 用户态映射 PCI BAR
→ 注册并映射 DMA 内存
→ PMD 读写寄存器和队列
```

VFIO 的关键价值不是“比 UIO 快”，而是提供 IOMMU 隔离、受控设备访问和更完善的中断/DMA 管理。

### 5.1 IOMMU Group

一个 Group 是 IOMMU 能保证隔离的最小设备集合。同组中若还有不能安全解绑的设备，VFIO 可能拒绝使用目标 NIC。

```bash
PCI_BDF=0000:af:00.0
readlink -f "/sys/bus/pci/devices/${PCI_BDF}/iommu_group"
find "$(readlink -f "/sys/bus/pci/devices/${PCI_BDF}/iommu_group")/devices" \
  -maxdepth 1 -mindepth 1 -printf '%f\n'
```

不能为了让 VFIO 工作就盲目开启 ACS Override，它可能制造表面分组却不能提供真实硬件隔离。

### 5.2 No-IOMMU 模式

VFIO No-IOMMU 缺少 DMA 隔离，错误设备或应用可能访问任意物理内存。只应在隔离实验环境中评估，不能把它当作生产常规配置。

## 6. 为什么 UIO 不应作为现代默认方案

旧资料常使用 `uio_pci_generic` 或 `igb_uio`。UIO 可以把 BAR 与中断暴露给用户态，但通常没有 VFIO/IOMMU 提供的 DMA 隔离能力。

| 方案 | DMA 隔离 | 现代生产建议 |
|------|----------|--------------|
| `vfio-pci` + IOMMU | 有 | 首选 |
| `vfio-pci` No-IOMMU | 无 | 仅受控实验 |
| `uio_pci_generic` | 通常无 | 兼容或实验用途 |
| Bifurcated Driver | 设备仍由内核驱动协作 | 取决于具体 PMD/NIC |

某些 PMD 使用 Bifurcated Driver，不要求把整个设备绑定到 `vfio-pci`。因此必须查看网卡对应的 DPDK NIC Guide，不能统一套用 devbind 流程。

## 7. NUMA 为什么决定性能

```text
Node 0：CPU Core + 本地 DRAM + PCIe Root Port + NIC 0
Node 1：CPU Core + 本地 DRAM + PCIe Root Port + NIC 1
```

最佳路径通常是：

```text
NIC Queue
↔ 同 NUMA 的 PMD Core
↔ 同 NUMA 的 Mempool/HugePage
```

跨 NUMA 不一定经过 CPU 核心执行复制，但访问会经过 Socket 间互联和远端内存控制器，增加时延并占用互联带宽。

```bash
lspci -s af:00.0 -vv
cat /sys/bus/pci/devices/0000:af:00.0/numa_node
numactl --hardware
```

设备 `numa_node` 为 `-1` 表示内核不知道，不等于它没有物理归属；应结合主板拓扑、`lspci -tv` 和厂商资料判断。

## 8. 常用 EAL 参数

| 参数 | 含义 | 注意事项 |
|------|------|----------|
| `-l 2-5` | 使用指定 Logical CPU | 避免占用系统和 IRQ 必需核心 |
| `--lcores` | 显式映射 lcore 与 CPU | 语法复杂，修改前验证 |
| `-n 4` | 内存 Channel 数提示 | 不是 CPU Core 数 |
| `-a BDF` | 允许指定 PCIe 设备 | 生产建议显式 allowlist |
| `--socket-mem` | 每个 Socket 的内存 MB | 顺序对应 NUMA Node |
| `--file-prefix` | 多进程/多实例共享文件前缀 | 实例间必须隔离 |
| `--in-memory` | 不依赖共享 hugetlbfs 文件 | 不支持需要共享内存的多进程模式 |
| `--huge-dir` | 指定 hugetlbfs 目录 | 注意页大小、权限和挂载 |
| `--log-level` | 设置日志范围与等级 | 故障时临时提高，不长期刷屏 |

## 9. 生产安全检查

在任何绑定动作前保存：

```bash
ip -br link
ip route
ethtool -i <interface>
lspci -nnk -s <BDF>
dpdk-devbind.py --status
```

确认目标端口不是 SSH、默认路由、集群控制面或存储管理口。绑定后 Linux 原生接口通常消失，NetworkManager、systemd-networkd 和内核防火墙不再管理该数据面。

## 10. 课后练习与答案

**问题 1：HugePage 为什么不能替代 IOMMU？**

HugePage解决页表/TLB和内存组织问题；IOMMU负责把设备 DMA 限制在授权地址范围，它们职责不同。

**问题 2：VFIO 绑定成功是否说明 NUMA 已正确？**

不是。设备所有权与 DMA 映射成功不代表 PMD Core、HugePage 和设备位于同一个 NUMA Node。

**问题 3：为什么绑定网卡前必须确认默认路由？**

绑定给用户态后原内核网络接口通常不可用；若它承载管理连接，操作会立即造成远程失联。

## 11. 参考资料

- [DPDK EAL](https://doc.dpdk.org/guides/prog_guide/env_abstraction_layer.html)
- [DPDK Linux Drivers](https://doc.dpdk.org/guides/linux_gsg/linux_drivers.html)
- [DPDK HugePage Tool](https://doc.dpdk.org/guides/tools/hugepages.html)
