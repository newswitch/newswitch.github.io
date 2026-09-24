---
title: "DPDK 从零到生产学习路线"
sidebar_label: "00. DPDK 从零到生产学习路线"
sidebar_position: 0
description: "从用户态网络原理进入 EAL、HugePage、VFIO、PMD、mbuf、testpmd、Kubernetes、性能调优和生产排障。"
tags: [DPDK, PMD, VFIO, HugePage, NUMA, testpmd]
---

# DPDK 从零到生产学习路线

DPDK（Data Plane Development Kit）是一组构建高速用户态数据面的库与驱动。它不会自动替代 TCP/IP、路由器或负载均衡器，而是提供高速收发包、内存、队列、CPU 和设备访问能力，具体协议与转发逻辑仍由应用实现。

> **版本基线（2026-09）**：实践以 DPDK `25.11 LTS` 为基线；当前功能文档可参考 `26.07`。现代 Linux 环境优先使用 `vfio-pci + IOMMU`，Meson/Ninja 是当前构建方式。UIO 只用于理解历史和明确接受风险的受控环境。

## 1. 文章顺序

| 序号 | 文章 | 核心问题 |
|------|------|----------|
| 01 | [DPDK 解决什么问题与收发包路径](./01-DPDK解决什么问题与收发包路径.md) | 为什么轮询和批处理能降低每包成本 |
| 02 | [EAL、HugePage、VFIO、IOMMU 与 NUMA](./02-EAL-HugePage-VFIO-IOMMU与NUMA.md) | 用户态如何安全访问设备和 DMA 内存 |
| 03 | [Ethdev、PMD 与网卡收发队列](./03-Ethdev-PMD与网卡收发队列.md) | 描述符、Burst、RSS、Offload 如何协作 |
| 04 | [Mbuf、Mempool、Ring 与无锁数据面](./04-Mbuf-Mempool-Ring与无锁数据面.md) | 包的元数据、对象池和核间传递如何工作 |
| 05 | [DPDK 编译安装与 testpmd](./05-DPDK编译安装与testpmd.md) | 如何安全建立可验证实验闭环 |
| 06 | [DPDK、SR-IOV 与 Kubernetes](./06-DPDK-SR-IOV与Kubernetes.md) | 容器中怎样获得设备、大页和独占 CPU |
| 07 | [DPDK 性能调优与故障排查](./07-DPDK性能调优与故障排查.md) | 如何用证据定位掉速、丢包和 NUMA 问题 |
| 08 | [DPDK 应用开发与源码阅读](./08-DPDK应用开发与源码阅读.md) | 如何理解初始化、Worker、错误回滚和 PMD 调用链 |

## 2. 必须先具备的基础

建议先掌握：

- PCIe BDF、BAR、MSI-X、DMA 与 IOMMU；
- 虚拟地址、物理页、HugeTLB 与 TLB；
- CPU Core、Logical CPU、NUMA Node、Cache Line；
- NIC RX/TX Queue、Descriptor、RSS 和硬件 Offload；
- 以太网、IPv4/IPv6、UDP/TCP 的基本报文结构。

缺少这些基础时，容易把 `vfio-pci` 当作“另一个网卡驱动”，却不理解设备所有权、DMA 隔离和管理口失联风险。

## 3. 从实验到生产的能力阶梯

```text
Level 1：能解释 Kernel Path 与 DPDK Path
Level 2：能启动 helloworld 和 testpmd
Level 3：能解释每个 EAL 和应用参数
Level 4：能按 NUMA 规划 Queue、Core、HugePage 和 NIC
Level 5：能在容器/Kubernetes 中稳定交付
Level 6：能做性能预算、监控、升级和故障定位
```

最终标准不是“跑出一个很高的 Mpps”，而是在固定包长、流量模型、CPU 数量、队列数和丢包目标下得到可重复结果，并能说明瓶颈发生在哪一层。

## 4. 与相邻技术的边界

| 技术 | 主要位置 | 更适合解决什么 |
|------|----------|----------------|
| Kernel Socket | Linux 网络栈 | 通用协议、生态与运维便利性 |
| XDP/AF_XDP | 内核驱动早期/共享 Ring | 过滤、转发和逐步旁路 |
| DPDK | 用户态网络驱动与库 | 高吞吐、低抖动、自定义数据面 |
| RDMA | NIC 与远端内存语义 | 低 CPU 的远程读写和消息传输 |
| SPDK | 用户态存储驱动与库 | NVMe、NVMe-oF 和高速块数据面 |

继续阅读[DPDK、SPDK、io_uring 与 RDMA](../../../storage/high-performance/01-DPDK-SPDK-io_uring与RDMA.md)，建立统一的高速 I/O 地图。

## 5. 参考资料

- [DPDK Downloads and LTS](https://core.dpdk.org/download/)
- [DPDK Linux Getting Started Guide](https://doc.dpdk.org/guides/linux_gsg/)
- [DPDK Programmer's Guide](https://doc.dpdk.org/guides/prog_guide/)
- [DPDK Testpmd Guide](https://doc.dpdk.org/guides/testpmd_app_ug/)
