---
title: "MMIO、PIO、DMA 与 IOMMU：CPU 和设备如何交换控制与数据"
sidebar_label: "05. MMIO、DMA 与 IOMMU"
sidebar_position: 5
description: "区分寄存器访问与批量数据搬运，理解 DMA mapping、IOVA、缓存一致性、IOMMU 和故障定位。"
tags: [Linux, MMIO, DMA, IOMMU, IOVA]
---

# MMIO、PIO、DMA 与 IOMMU：CPU 和设备如何交换控制与数据

CPU 通常通过设备寄存器下命令，设备通过 DMA 直接读写主存中的数据和描述符。两条路径用途不同：MMIO 适合控制，DMA 适合批量数据。

## 1. 数据路径

```text
驱动分配/映射 buffer
→ 获得设备可使用的 DMA address（可能是 IOVA）
→ 填 descriptor 并执行必要屏障
→ MMIO 写 doorbell
→ 设备 DMA 读 descriptor/数据并执行
→ 设备 DMA 写 completion/数据
→ IRQ 或轮询通知驱动
→ 驱动同步、回收 descriptor 和 buffer
```

## 2. CPU 地址、物理地址与 DMA 地址

三者不能混用：

- CPU 虚拟地址供内核解引用。
- 物理地址描述主机物理地址空间。
- DMA 地址是设备看到的地址；启用 IOMMU 时通常为 IOVA。

驱动必须用 DMA API 建立映射，不能把 `virt_to_phys` 结果随意交给设备。

## 3. Coherent 与 Streaming DMA

- coherent mapping：CPU 与设备对共享区域的可见性由平台/API 保证，仍需正确的顺序屏障。
- streaming mapping：为一次或一段方向明确的传输映射，需要按 ownership 转换调用 map/unmap 或 sync。

DMA direction 错误可能导致数据不一致或不必要同步。

## 4. IOMMU 的作用

IOMMU 把 IOVA 翻译为物理页，并限制设备可 DMA 的范围：

```text
device Requester ID + IOVA
→ IOMMU domain/page table
→ host physical page
```

它提供隔离、scatter-gather 重映射和虚拟化基础，但会增加映射/翻译成本；IOTLB、批量映射和大页影响性能。

```bash
dmesg -T | grep -Ei 'iommu|dmar|smmu|fault'
find /sys/kernel/iommu_groups -maxdepth 2 -type l 2>/dev/null | head
```

IOMMU fault 通常包含设备标识、IOVA 和访问类型。原因可能是驱动提前 unmap、长度/方向错误、设备继续 DMA、固件保留区或硬件故障。

## 5. MMIO 不能普通解引用

设备寄存器具有副作用、宽度和顺序要求。驱动应使用 `ioremap` 与 `readl/writel` 等访问器；编译器 `volatile` 不能替代架构访问和 IO barrier。

## 6. 练习与答案

**问题：DMA 是否表示数据不经过内存控制器？**

答案：不是。它表示搬运不由 CPU 执行逐字节 load/store；设备事务仍经过 PCIe/互连、IOMMU（若启用）和内存系统。

**问题：开启 IOMMU 就能阻止所有恶意设备吗？**

答案：它显著限制 DMA 范围，但整体安全仍依赖正确 domain 分配、内核/固件、interrupt remapping 和驱动。

下一篇：[字符、块与网络设备接口](./06-字符块与网络设备接口.md)
