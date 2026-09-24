---
title: "SPDK 从零到生产学习路线"
sidebar_label: "00. SPDK 从零到生产学习路线"
sidebar_position: 0
description: "从用户态存储原理进入 Reactor、Poller、NVMe Driver、bdev、Blobstore、NVMe-oF、JSON-RPC、性能和故障排查。"
tags: [SPDK, NVMe, bdev, NVMe-oF, VFIO, HugePage]
---

# SPDK 从零到生产学习路线

SPDK（Storage Performance Development Kit）提供构建高性能用户态存储应用的库和工具。它通过用户态驱动、轮询、异步 I/O、线程独占资源和消息传递减少系统调用、中断、锁与上下文切换开销。

> **版本基线（2026-09）**：生产学习基线使用 `26.01 LTS`，同时说明 `26.05` 的新增与废弃项。SPDK 每年 1、5、9 月发布，1 月版本为 LTS；JSON-RPC、公共 API 和废弃参数必须按实际版本核对。

## 1. 文章顺序

| 序号 | 文章 | 核心问题 |
|------|------|----------|
| 01 | [SPDK 解决什么问题与一次 I/O 路径](./01-SPDK解决什么问题与一次IO路径.md) | 为什么绕过内核块层可以降低软件开销 |
| 02 | [Reactor、Thread、Poller 与消息模型](./02-Reactor-Thread-Poller与消息模型.md) | SPDK 如何用无共享线程模型组织执行 |
| 03 | [SPDK NVMe 驱动、队列与 DMA](./03-SPDK-NVMe驱动队列与DMA.md) | 用户态如何直接提交 NVMe 命令 |
| 04 | [bdev、I/O Channel、Blobstore 与 Lvol](./04-Bdev-IO-Channel-Blobstore与Lvol.md) | 如何抽象并组合存储后端 |
| 05 | [SPDK 编译安装、HugePage 与 VFIO](./05-SPDK编译安装-HugePage与VFIO.md) | 如何安全建立实验环境 |
| 06 | [NVMe-oF Target、RDMA 与 TCP](./06-NVMe-oF-Target-RDMA与TCP.md) | 怎样把 bdev 作为远端 NVMe Namespace 输出 |
| 07 | [JSON-RPC 配置与生产部署](./07-JSON-RPC配置与生产部署.md) | 如何动态配置、固化、启动和升级 |
| 08 | [SPDK 性能测试与故障排查](./08-SPDK性能测试与故障排查.md) | 如何定位队列、CPU、NUMA、内存和网络瓶颈 |
| 09 | [SPDK vhost、Virtio 与虚拟化存储](./09-SPDK-vhost-Virtio与虚拟化存储.md) | Guest、QEMU、vhost-user 和 bdev 如何协作 |
| 10 | [SPDK 应用开发与源码阅读](./10-SPDK应用开发与源码阅读.md) | 如何编写异步状态机并追踪 Framework、bdev 与 NVMe 源码 |

## 2. 前置知识

- Linux VFS、页缓存、Direct I/O 和块层；
- NVMe Submission Queue、Completion Queue、Doorbell、Namespace；
- PCIe BDF、BAR、DMA、IOMMU 和 VFIO；
- CPU Core、NUMA、Cache Line、HugePage；
- NVMe-oF 中的 Host、Target、Subsystem、Controller、Namespace 和 NQN。

## 3. 学习结果

```text
理解用户态 I/O
→ 能运行 identify/bdevperf
→ 能构造 bdev
→ 能发布 NVMe-oF Target
→ 能解释每一个 JSON-RPC 对象
→ 能做基准、容量和生产排障
```

SPDK 的目标不是让所有存储应用都绕过内核。需要 POSIX 文件系统、Page Cache、通用工具链或低空闲 CPU 消耗时，Linux 内核路径可能更合适。

## 4. 参考资料

- [SPDK Documentation](https://spdk.io/doc/)
- [SPDK Releases](https://spdk.io/doc/releases.html)
- [SPDK Getting Started](https://spdk.io/doc/getting_started.html)
- [SPDK JSON-RPC](https://spdk.io/doc/jsonrpc.html)
