---
title: "DMA、中断与 I/O 完成：设备如何把数据交还给内核"
sidebar_label: "04. DMA、中断与 I/O 完成"
sidebar_position: 4
description: "解释 DMA 映射、scatter-gather、IOMMU、提交队列、MSI-X、中断亲和性、轮询和完成回调。"
tags: [Linux, DMA, IOMMU, IRQ, MSI-X]
---

# DMA、中断与 I/O 完成：设备如何把数据交还给内核

CPU 通常负责准备命令和缓冲区，设备通过 DMA 在设备与内存之间搬运数据，完成后用中断或轮询通知。数据不需要由 CPU 指令逐字节复制，但 CPU、内存控制器、IOMMU 和互连仍参与建立和维护路径。

## 1. 读取完成的概念路径

```text
内核准备内存页和 scatter-gather 列表
→ DMA API 建立设备可访问的地址映射
→ 驱动填写 submission descriptor
→ 通知控制器
→ 设备读取介质并 DMA 写入内存
→ 写 completion entry
→ 触发 MSI-X 或被轮询发现
→ 驱动完成 request/bio
→ 唤醒等待线程或触发异步回调
```

设备看到的 DMA 地址不一定等于 CPU 物理地址，IOMMU 可提供 IOVA 映射、隔离和重映射。

## 2. Scatter-Gather

用户/页缓存缓冲区在物理内存可不连续。Scatter-Gather 列表描述多个内存段，让设备在一次命令或有限描述符中处理，避免为了物理连续而复制整个缓冲区。

设备有最大 segment 数、长度和边界限制，DMA 层和块层可能合并或拆分段。

## 3. Cache 一致性

在 cache-coherent 平台，硬件和 DMA API 帮助维持 CPU Cache 与设备可见内存的一致；非一致平台需要显式同步。驱动必须使用正确 DMA API，不能假设所有架构行为与 x86 相同。

## 4. MSI-X 与多队列

现代控制器可为多个队列分配 MSI-X 向量，把完成中断分散到多个 CPU：

```bash
grep -i -E 'nvme|scsi|virtio' /proc/interrupts
cat /proc/irq/<IRQ>/smp_affinity_list
```

中断亲和性与提交 CPU、NUMA Node、设备队列配合得好，可以提高局部性；全部中断集中到一个核会形成单核瓶颈。

## 5. 中断与轮询

- 中断节省空闲 CPU，但有进入/退出和调度延迟。
- 轮询消耗 CPU 持续检查完成，可能降低极低延迟场景的通知开销。
- 混合/自适应模式在吞吐和延迟间折中。

不能因为“轮询更快”就在共享节点开启忙轮询；它会消耗 CPU 并影响其他任务。

## 6. 完成不等于持久化

设备报告普通写命令完成，可能表示数据进入控制器易失缓存。文件系统通过 flush/FUA 和设备能力协商要求持久化顺序。带电池/电容保护缓存与无保护缓存的掉电风险不同。

## 7. NUMA 路径

设备挂在某个 PCIe Root Complex 下。DMA 到同 Node 内存通常路径更直接；访问远端 Node 会跨 Socket 互连。块层队列、IRQ、提交线程和缓冲区页面分布共同决定局部性。

## 8. 练习与答案

**问题：使用 DMA 是否表示 CPU 和内存带宽都不受影响？**

答案：不是。CPU 仍准备/完成请求并维护映射，DMA 占用内存控制器和互连带宽，还可能引发缓存一致性流量和中断处理。

**问题：写完成中断到了是否等于掉电不丢？**

答案：不一定。要看命令语义、flush/FUA、设备缓存与掉电保护，以及上层文件系统和应用持久化协议。

下一篇：[同步、异步 IO 与 io_uring](./05-同步异步IO与io_uring.md)
