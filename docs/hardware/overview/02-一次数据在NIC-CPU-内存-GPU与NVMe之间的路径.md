---
title: "一次数据在 NIC、CPU、内存、GPU 与 NVMe 之间的路径"
sidebar_label: "02. 整机数据路径"
sidebar_position: 2
description: "用 DMA、IOMMU、PCIe、NUMA、Cache Coherency 和 Peer-to-Peer 串联服务器中的一次完整数据搬运。"
tags: [DMA, IOMMU, PCIe, NUMA, NIC, GPU, NVMe]
---

# 一次数据在 NIC、CPU、内存、GPU 与 NVMe 之间的路径

“数据经过 CPU”容易产生歧义。CPU 可以负责提交描述符和处理完成通知，但大量 Payload 由设备 DMA 直接写入内存；跨 NUMA 又可能经过 Socket 互联；GPUDirect 还可能绕过主机内存。必须把控制路径和数据路径分开。

## 1. 五个关键参与者

| 参与者 | 主要职责 |
| --- | --- |
| CPU Core | 执行程序、驱动、提交队列、处理协议和控制 |
| DRAM | 普通 DMA 缓冲、页缓存、应用数据 |
| PCIe Root Complex | 连接 CPU/内存系统与 Endpoint |
| IOMMU | 将设备 I/O Virtual Address 翻译为物理地址并隔离 |
| Endpoint | NIC、NVMe、GPU 等真正搬运或处理数据的设备 |

PCIe Switch 负责转发 Transaction，Retimer 重整高速信号；它们不等同于 CPU，也不执行应用协议。

## 2. NIC 接收数据到应用

```text
线缆/光模块
→ NIC PHY/MAC/ASIC
→ 匹配 RX Queue
→ NIC DMA 报文到主机内存 RX Buffer
→ 写 Completion，触发 MSI-X 或由 NAPI Poll
→ 驱动构造/关联 skb
→ Linux 网络栈
→ Socket Receive Buffer
→ 应用 read/recv
```

CPU 事先通过驱动把 Buffer Address 和长度放入 RX Descriptor Ring。报文到达后，NIC 才知道把数据 DMA 到哪里。

## 3. 应用写入 NVMe

```text
应用 write/io_uring
→ 文件系统 / Direct I/O
→ Block Layer / blk-mq
→ NVMe Driver 构造 Submission Queue Entry
→ Doorbell 通知 NVMe Controller
→ Controller DMA 读取主机数据
→ FTL 映射到 NAND Page
→ 完成写入并更新 Completion Queue
→ MSI-X / Poll 通知 CPU
```

CPU 不需要逐字节复制到 SSD Controller，但负责准备内存、队列和命令。Buffered I/O 还会先写 Page Cache，`fsync`/回写路径决定何时真正提交设备。

## 4. CPU 向 GPU 传输

普通 Host-to-Device：

```text
应用内存
→ 若非 Pinned，先复制到 Pinned/Staging Buffer
→ GPU Copy Engine 发起 PCIe DMA
→ Root Complex / PCIe Switch
→ GPU HBM
```

Pinned Memory 让物理页在 DMA 期间保持稳定，并可被设备映射；它不是“更快的 DRAM”，过量锁页会伤害主机内存管理。

## 5. NIC 到 GPU 的两种路径

普通路径：

```text
NIC → DMA 到 Host DRAM → CPU/驱动协调 → DMA 到 GPU HBM
```

GPUDirect RDMA：

```text
NIC → PCIe Peer-to-Peer → GPU HBM
```

GPUDirect 仍需要 CPU 建立 Queue、注册内存和处理控制面，只是 Payload 不必以 Host DRAM 为中转。是否真正走 Peer-to-Peer 取决于 GPU/NIC、驱动、IOMMU、PCIe ACS、Root/Switch 拓扑和软件栈。

## 6. NVMe 到 GPU

普通模型文件读取：

```text
NVMe → Host Page Cache/Buffer → CPU/Runtime → GPU HBM
```

GPUDirect Storage 目标路径：

```text
NVMe / Storage Client
→ DMA/Peer Path
→ GPU HBM
```

它减少主机 Bounce Buffer 和 CPU 参与，但文件系统、驱动、设备、拓扑和对齐必须满足条件；“装了库”不等于所有 I/O 自动绕过 Host Memory。

## 7. 跨 NUMA 路径

若 NIC 属于 CPU0，但 Buffer 分配在 CPU1 内存：

```text
NIC（CPU0 Root）
→ CPU0 I/O/Coherency Fabric
→ UPI/xGMI
→ CPU1 IMC
→ CPU1 DIMM
```

如果处理线程又在 CPU0，后续 Load 还需访问远端内存。性能问题可能来自远端内存、Socket 互联饱和或不正确 IRQ/RSS 亲和性，而不是 NIC 线速不足。

## 8. Cache Coherency 与 DMA

设备 DMA 修改内存后，CPU Cache 不能继续看到陈旧数据。服务器平台通过硬件一致性、DMA API、Cache Flush/Invalidate 或一致性内存属性保证可见性，具体机制取决于架构和设备。

驱动不能随意把普通虚拟地址交给设备。它使用 DMA Mapping API 获得设备可访问地址，并在正确时机同步和解除映射。

## 9. IOMMU 的作用

```text
Device DMA Address（IOVA）
→ IOMMU Page Table
→ Host Physical Address
```

IOMMU 提供隔离、地址重映射和虚拟化设备直通基础。它可能引入 Translation/IOTLB 成本，但不能为了性能随意关闭；Huge Page、合理 Mapping 和设备能力可降低开销。

## 10. Doorbell、Descriptor 与 Completion

高性能设备普遍采用相似模型：

```text
CPU 在内存写 Descriptor
→ 写 MMIO Doorbell 通知设备
→ 设备 DMA 读取/写入 Payload
→ 设备写 Completion
→ Interrupt 或 Polling 通知 CPU
```

NIC Queue、NVMe SQ/CQ、GPU Command Queue 的细节不同，但“共享队列 + Doorbell + DMA + Completion”是理解硬件并发的重要抽象。

## 11. 性能计算

端到端上限取决于最窄链路：

```text
有效吞吐 ≤ min(
  NIC/Storage 介质吞吐，
  PCIe 有效带宽，
  Socket Interconnect，
  DRAM 带宽，
  GPU HBM/Compute 消费能力
)
```

还要考虑单次传输大小、Queue Depth、协议开销、NUMA、Copy 次数和同步。小 I/O 常受延迟与 IOPS 限制，大块流式传输才更接近带宽上限。

## 12. 排障证据

| 层次 | 证据 |
| --- | --- |
| PCIe/NUMA | `lspci -tv`、`numactl -H`、设备 `numa_node` |
| NIC | `ethtool -S`、Queue/IRQ、丢包、FEC |
| NVMe | `nvme smart-log`、Queue、Block Layer 延迟 |
| GPU | `nvidia-smi topo -m`、PCIe/NVLink、Copy Engine |
| CPU/内存 | PMU、Cache Miss、内存带宽、UPI/xGMI 流量 |
| IOMMU | Kernel Log、IOMMU Fault、Mapping/Group |

先画实际路径，再决定采集哪一段指标。单看 GPU Util 或 CPU Util 无法证明数据通路健康。

## 13. 练习与答案

**问题：NIC 和 GPU 在同一 NUMA Node，是否一定能直接 P2P？**

答案：不一定。同 NUMA 只说明 CPU/内存归属接近，还需看是否同一 PCIe Root/Switch、ACS/IOMMU 设置、设备和驱动是否支持 GPUDirect RDMA。

**问题：DMA 是否表示 CPU 完全不参与？**

答案：不是。CPU/驱动负责分配和映射 Buffer、填 Descriptor、写 Doorbell、处理 Completion 和错误；DMA 只是避免 CPU 逐字节搬运 Payload。

延伸阅读：

- [CPU 与 GPU 之间的数据搬运](../../gpu/pcie-numa/05-CPU与GPU之间的数据搬运.md)
- [GPUDirect Storage 原理与实践](../../storage/ai-workloads/02-GPUDirect-Storage原理与实践.md)
- [GPU Direct RDMA 原理与实践](../../networking/rdma-roce/ai-cluster/07-GPUDirect-RDMA原理与实践.md)
