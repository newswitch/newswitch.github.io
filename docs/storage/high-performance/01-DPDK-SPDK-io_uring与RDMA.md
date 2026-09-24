---
title: "DPDK、SPDK、iouring 与 RDMA：高速 I/O 技术地图"
sidebar_label: "01. DPDK、SPDK、iouring 与 RDMA"
sidebar_position: 1
description: "从内核旁路、异步提交、DMA 和远程访问语义区分 DPDK、SPDK、io_uring、XDP、AF_XDP 与 RDMA。"
tags: [DPDK, SPDK, io_uring, RDMA, XDP, 用户态IO]
---

# DPDK、SPDK、iouring 与 RDMA：高速 I/O 技术地图

这些技术经常同时出现，但它们不在同一个抽象层，也不是相互替代的同类产品。

## 1. 一张表先分清

| 技术 | 主要对象 | 是否通常绕过内核数据面 | 核心收益 | 主要代价 |
|------|----------|------------------------|----------|----------|
| io_uring | 文件、Socket、块 I/O | 否 | 批量异步提交、减少系统调用 | 仍受内核对象和调度约束 |
| XDP | 网卡驱动早期的 Packet | 否，运行在内核/eBPF | 很早过滤和转发 | 程序与能力受 eBPF 约束 |
| AF_XDP | XDP Queue 与用户态 Ring | 部分旁路 | 用户态高速包处理并保留内核协作 | 配置、驱动和零拷贝能力相关 |
| DPDK | NIC Queue 与 Packet Buffer | 是 | PMD 轮询、批处理、自定义网络数据面 | 独占 CPU/设备，协议需应用实现 |
| SPDK | NVMe Queue 与 Block I/O | 是 | 用户态 NVMe、轮询、无锁 I/O 路径 | 独占设备/CPU，POSIX 能力需额外层 |
| RDMA | Queue Pair 与注册内存 | 数据路径通常旁路远端内核 | 远程读写、低 CPU、低延迟 | 注册内存、网络和拥塞配置复杂 |

## 2. 共同底层

DPDK 和 SPDK 的共同思想包括：

```text
PCIe 设备
→ VFIO/IOMMU 建立安全所有权与 DMA 映射
→ HugePage 降低页表和 TLB 压力
→ 每核固定线程与 NUMA 本地内存
→ Polling 减少中断和唤醒抖动
→ Batch 分摊 MMIO、同步和函数调用成本
→ 无锁或消息传递减少共享写竞争
```

它们都可以使用 DPDK 的环境抽象能力，但上层对象不同：DPDK 的核心对象是 Packet、NIC Queue 和 mbuf；SPDK 的核心对象是 Block I/O、NVMe Queue Pair 和 bdev。

## 3. 一次网络 I/O 与存储 I/O

### 3.1 DPDK

```text
NIC DMA 写入 mbuf Data Room
→ PMD 批量读取 RX Descriptor
→ 应用处理 Packet
→ PMD 写 TX Descriptor
→ NIC DMA 读取 Packet 并发出
```

### 3.2 SPDK

```text
应用构造异步 Block I/O
→ bdev 转换并选择 I/O Channel
→ NVMe Driver 写 Submission Queue + Doorbell
→ SSD DMA 读写用户态 Buffer
→ Driver 轮询 Completion Queue
→ 在所属 SPDK Thread 执行 Completion Callback
```

## 4. 为什么轮询更快但更耗 CPU

中断模式在空闲时节能，但 I/O 到达后需要中断、调度和唤醒。轮询线程始终检查完成队列，减少唤醒路径和时延抖动，却会在无请求时消耗 CPU。

现代实现并非只能二选一：DPDK 可使用中断辅助的电源管理，SPDK 的部分 NVMe/NVMe-oF 路径也支持中断模式。是否启用取决于低负载功耗目标、时延 SLO 和具体设备/传输支持。

## 5. 技术选择

| 场景 | 优先评估 |
|------|----------|
| 普通 Web 服务与数据库 | Kernel Socket、文件系统、io_uring |
| 高速防火墙、vSwitch、UPF | DPDK 或 XDP/AF_XDP |
| 自研用户态存储服务 | SPDK bdev/NVMe Driver |
| 远程块设备服务 | SPDK NVMe-oF 或内核 NVMe-oF |
| GPU 跨节点集合通信 | RDMA、NCCL/HCCL，而不是 DPDK |
| DPU/SmartNIC 网络与存储卸载 | DPDK + SPDK + RDMA，按数据路径组合 |

## 6. 常见误解

1. **“零拷贝等于没有 DMA。”** 错。DMA 正是设备直接访问内存的关键，零拷贝通常表示减少 CPU 参与的数据复制。
2. **“绕过内核就没有内核参与。”** 错。进程、内存、VFIO、IOMMU、调度和权限仍由内核管理。
3. **“DPDK 可以直接加速磁盘。”** DPDK 主要面向包 I/O；SPDK 才提供用户态存储栈。
4. **“SPDK 等于 NVMe-oF。”** NVMe-oF Target 只是 SPDK 的一个应用，SPDK 还包含 NVMe Driver、bdev、Blobstore、vhost 等。
5. **“性能高就应该全面替换内核路径。”** 还要计算独占 CPU、可维护性、安全、生态和故障恢复成本。

## 7. 课后练习与答案

**问题 1：io_uring 为什么不等于内核旁路？**

它优化用户态与内核之间的异步提交/完成方式，但 I/O 仍由 Linux 文件、网络或块设备子系统执行。

**问题 2：DPDK 和 SPDK 为什么都关注 NUMA？**

NIC/NVMe、CPU 和内存若跨 Socket，数据与队列访问会经过 Socket 互联，增加延迟并消耗互联带宽。

**问题 3：RDMA 与 DPDK 能否同时使用？**

可以。它们可能用于同一产品的不同路径，但 RDMA Verbs 和 DPDK PMD 是不同编程接口，设备所有权及驱动模式必须按硬件能力规划。

## 8. 参考资料

- [DPDK Programmer's Guide](https://doc.dpdk.org/guides/prog_guide/)
- [SPDK Documentation](https://spdk.io/doc/)
- [Linux io_uring](https://docs.kernel.org/io_uring/)
- [Linux AF_XDP](https://docs.kernel.org/networking/af_xdp.html)
