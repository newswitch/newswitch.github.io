---
title: "SPDK 解决什么问题与一次 I/O 的完整路径"
sidebar_label: "01. 定位与一次 I/O 路径"
sidebar_position: 1
description: "对比 Linux 块 I/O 与 SPDK 用户态路径，理解轮询、异步、无锁、DMA 和线程独占的性能来源。"
tags: [SPDK, NVMe, Kernel Bypass, DMA, Polling, Block IO]
---

# SPDK 解决什么问题与一次 I/O 的完整路径

现代 NVMe SSD 的设备时延已经很低。当单盘和多盘并行能力提高后，系统调用、块层、上下文切换、中断和锁的相对成本变得明显。SPDK 把 NVMe Driver 和存储服务数据面放到用户态，采用异步轮询和线程独占对象降低软件开销。

## 1. Linux 块 I/O 路径

以 Direct I/O 为例，路径可简化为：

```text
应用
→ read/write/io_uring
→ VFS / 文件系统
→ Block Layer / blk-mq
→ NVMe Kernel Driver
→ Submission Queue
→ SSD 执行 DMA
→ Completion Queue / MSI-X
→ Block Completion
→ 唤醒应用或提交 CQE
```

Linux 路径提供文件系统、页缓存、权限、调度、Cgroup、通用设备管理和成熟工具。它不是“性能差”的同义词，io_uring、blk-mq 和现代 NVMe Driver 已能提供很高性能。

## 2. SPDK NVMe 路径

```text
SPDK 应用在所属 spdk_thread 提交异步 I/O
→ bdev / NVMe Driver 构造命令
→ 写 NVMe Submission Queue
→ 更新 Doorbell
→ SSD 从用户态 Buffer DMA 读写数据
→ SSD 写 Completion Queue
→ Poller 轮询完成项
→ 在所属线程执行 Completion Callback
```

主要变化：

1. 用户态直接管理 NVMe Queue Pair；
2. I/O 从提交开始就是异步 Callback 模型；
3. Poller 减少中断与线程唤醒；
4. I/O Channel 和 Queue Pair 通常归单一线程所有，减少锁；
5. Buffer 使用可 DMA 的 HugePage 内存，并通过 VFIO/IOMMU 映射。

## 3. SPDK 的四个核心原则

### 3.1 用户态驱动

NVMe Controller 从内核 `nvme` 驱动解绑，绑定给 `vfio-pci`，SPDK 直接访问 BAR、Queue 和 Doorbell。内核仍管理进程、内存、VFIO、IOMMU 和权限。

### 3.2 Polling

固定 Core 上的 Reactor 持续执行 Poller，及时发现完成项。它用 CPU 资源换取更少的中断、调度和尾延迟抖动。

### 3.3 异步到完成

调用提交函数只表示请求进入系统，真正完成通过 Callback 通知。同步等待会阻塞 Reactor，破坏整个线程上的其他 I/O。

### 3.4 Share-Nothing

对象和 I/O Channel 归某个 SPDK Thread 使用。跨线程工作通过 Message 传递，而不是让多个线程带锁修改同一对象。

## 4. 一次写 I/O 经历什么

### 4.1 准备 Buffer

应用准备 DMA 可访问的 Buffer。来自普通 `malloc()` 的内存不一定满足 SPDK 和设备映射要求，常使用 `spdk_dma_malloc()`、`spdk_zmalloc()` 或框架管理的 I/O Buffer。

### 4.2 通过 bdev 提交

应用持有 bdev Descriptor 和当前线程的 I/O Channel，调用异步写接口。bdev 层把统一 Block I/O 转交给具体模块，例如 NVMe、Malloc、AIO、RBD、RAID 或 Logical Volume。

### 4.3 NVMe Driver 入队

Driver 分配 Request，填充 NVMe Command 和 PRP/SGL，写入 Submission Queue，再更新 Doorbell 通知 Controller。

### 4.4 SSD 执行 DMA

写操作时 SSD 从 Host Buffer 读取数据；读操作时 SSD 向 Host Buffer 写入数据。IOMMU 负责把设备使用的 IOVA 翻译到授权物理页。

### 4.5 Poller 收割完成

Poller 检查 Completion Queue，匹配请求并执行 Callback。Callback 必须短小，复杂工作应拆分或发消息给其他线程，否则会阻塞同一 Reactor 的后续完成处理。

## 5. SPDK 不等于“没有复制”

用户态 NVMe 可以让设备直接 DMA 到应用 Buffer，但上层协议或数据变换仍可能复制：

- 网络接收 Buffer 到存储 Buffer；
- 加密、压缩、校验或纠删码；
- 未对齐 I/O 的 Bounce Buffer；
- vhost/virtio Guest 与 Host 之间的映射；
- bdev 模块堆叠造成的数据重排。

必须画出真实 Buffer 所有权和地址映射，不能只用“零拷贝”概括。

## 6. 轮询与中断的取舍

| 模式 | 空闲 CPU | 平均/尾延迟 | 适合场景 |
|------|----------|-------------|----------|
| 持续轮询 | 高 | 低且较稳定 | 高负载、低延迟数据面 |
| 中断 | 低 | 有唤醒开销 | 低负载、节能优先 |
| 自适应/混合 | 中 | 依赖切换策略 | 负载变化明显 |

SPDK 的部分 NVMe、NVMe-oF TCP/RDMA 路径已经支持中断模式，但能力与配置依赖版本和模块。不要把“SPDK 永远只能忙轮询”或“开启中断完全没有性能代价”当成固定结论。

## 7. 什么时候不该用 SPDK

- 应用依赖 POSIX 文件系统和 Page Cache；
- 性能瓶颈不在块 I/O 软件栈；
- 无法独占 NVMe 或不能安全使用 VFIO；
- 空闲功耗和 CPU 密度比微秒级时延更重要；
- 团队缺少异步编程、设备恢复和 NUMA 调优能力；
- 现有内核 NVMe/io_uring 已满足 SLO。

## 8. 延迟预算

```text
应用排队
+ bdev 模块处理
+ NVMe SQ 提交与 Doorbell
+ PCIe 传输
+ SSD Controller/FTL/NAND
+ CQ 完成可见
+ Poller 下一轮检查
+ Completion Callback
```

SPDK 主要减少 Host Software 部分，不能消除 SSD Media、GC、Thermal Throttling、PCIe 降速和远端网络延迟。

## 9. 课后练习与答案

**问题 1：SPDK 为什么仍需要 Linux 内核？**

它仍依赖 Linux 管理进程、页表、HugePage、VFIO、IOMMU、CPU 调度和权限，只绕过常规存储数据面。

**问题 2：NVMe 已经很快，SPDK 的收益为什么更明显？**

设备时延降低后，系统调用、中断、调度和锁等固定软件成本在总时延中的比例上升。

**问题 3：Callback 中执行长时间计算会怎样？**

它会占住所属 Reactor，延迟同一线程上其他 Poller 和 I/O Completion，放大尾延迟。

## 10. 参考资料

- [SPDK Introduction](https://spdk.io/doc/intro.html)
- [SPDK NVMe Driver](https://spdk.io/doc/nvme.html)
- [SPDK Event Framework](https://spdk.io/doc/event.html)
