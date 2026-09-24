---
title: "Linux 高性能网络学习路线"
sidebar_label: "00. Linux 高性能网络学习路线"
sidebar_position: 0
description: "从内核收发包、队列与软中断进入零拷贝、XDP、DPDK、RDMA，并建立性能测试、容量规划和故障排查能力。"
tags: [Linux, 高性能网络, DPDK, XDP, RDMA, NUMA]
---

# Linux 高性能网络学习路线

高性能网络不是简单地“绕过内核”。真正需要回答的是：包在哪个队列、由哪个 CPU 处理、数据复制了几次、谁在轮询、DMA 映射是否安全，以及吞吐提高后牺牲了什么。

## 1. 学习顺序

```text
普通 Socket 收发路径
→ 网卡 RX/TX Queue、DMA 与描述符
→ IRQ、NAPI、SoftIRQ、RPS/RFS/XPS
→ GRO/GSO/TSO、RSS 与零拷贝
→ XDP/AF_XDP 的内核快速路径
→ DPDK 用户态数据面
→ RDMA 与 GPUDirect
→ NUMA、CPU、队列和设备联合调优
```

| 阶段 | 文章 | 学习目标 |
|------|------|----------|
| 1 | [Linux 高性能网络原理](./01-linux高性能网络详解读书笔记（一）.md) | 建立内核协议栈与硬件卸载基础 |
| 2 | [Linux 收发包路径与队列](./04-Linux收发包路径与队列.md) | 理解网卡队列、NAPI、SoftIRQ 和 CPU 亲和性 |
| 3 | [DPDK 从零到生产](./dpdk/00-DPDK从零到生产学习路线.md) | 掌握 EAL、VFIO、PMD、mbuf、testpmd 与生产调优 |
| 4 | [RDMA](../rdma-roce/01-RDMA技术详解（一）：RDMA概述.md) | 理解 Queue Pair、Memory Region 与 One-Sided I/O |
| 5 | [DPDK、SPDK、io_uring 与 RDMA](../../storage/high-performance/01-DPDK-SPDK-io_uring与RDMA.md) | 建立不同高速 I/O 技术的边界 |

## 2. 完成后的能力

- 能画出一个包从 NIC RX Queue 到应用，再从应用到 TX Queue 的路径；
- 能解释中断、轮询、批处理、忙等和尾延迟之间的关系；
- 能安全完成 HugePage、IOMMU、VFIO、NUMA 和 CPU 隔离配置；
- 能使用 testpmd 建立最小闭环，而不是只看进程是否启动；
- 能区分丢包发生在 NIC、描述符、mbuf、软件 Ring、应用还是对端；
- 能判断 DPDK、XDP、普通 Socket 或 RDMA 哪种技术更适合当前问题。

## 3. 版本原则

DPDK 的非 LTS 分支更新较快。本文体系以 `25.11 LTS` 为可复现基线，同时核对 `26.07` 当前文档；命令、驱动与网卡能力以目标发行版、内核和 PMD 指南为准。生产环境应锁定版本，不直接跟随 `main` 或 `latest`。
