---
title: "设备发现：ACPI、Device Tree 与平台设备如何描述不可枚举硬件"
sidebar_label: "02. ACPI、Device Tree 与平台设备"
sidebar_position: 2
description: "理解固件表、设备树、platform bus、资源描述和驱动 compatible/HID 匹配。"
tags: [Linux, ACPI, Device Tree, Platform Device, Firmware]
---

# 设备发现：ACPI、Device Tree 与平台设备如何描述不可枚举硬件

PCIe、USB 能通过协议枚举设备，但 SoC 上的 UART、I2C 控制器、GPIO 等通常无法自行报告“我在哪里、用哪些寄存器和中断”。固件描述补足这些信息。

## 1. ACPI 与 Device Tree

| 维度 | ACPI | Device Tree |
|---|---|---|
| 常见平台 | x86 服务器/PC，也可用于 ARM | ARM、RISC-V、嵌入式 |
| 描述方式 | 表、AML 方法、设备对象 | DTB 树状节点与属性 |
| 匹配标识 | HID/CID 等 | `compatible` 字符串 |
| 固件逻辑 | 可包含 AML 控制方法 | 主要为声明式硬件描述 |

二者都可能描述地址、IRQ、DMA、时钟、电源域和设备依赖。驱动不应把板级物理地址硬编码在通用源码中。

## 2. Device Tree 示例逻辑

```text
uart@10000000
├─ compatible = vendor,soc-uart
├─ reg = <address size>
├─ interrupts = <...>
├─ clocks = <...>
└─ status = okay
```

`reg` 的单元数和地址解释由父节点的 `#address-cells/#size-cells` 决定；不能脱离上下文直接把十六进制值当 CPU 物理地址。

## 3. Platform bus

内核把固件描述转换为 `platform_device`，平台驱动依据 ACPI ID、OF compatible 或名称匹配，随后 `probe` 使用受管资源 API 获取 MMIO/IRQ/clock/reset。

```bash
find /sys/bus/platform/devices -maxdepth 1 -mindepth 1 | head
find /sys/firmware/devicetree/base -maxdepth 2 -type f 2>/dev/null | head
ls /sys/firmware/acpi/tables 2>/dev/null
```

## 4. Probe defer

设备 A 依赖的 regulator/clock/IOMMU 驱动尚未就绪时，A 的 probe 可返回 deferred，稍后重试。启动日志里反复 deferred 不一定是错误；最终仍未绑定则要检查依赖是否缺失或描述有环。

```bash
cat /sys/kernel/debug/devices_deferred 2>/dev/null
dmesg -T | grep -Ei 'defer|ACPI|OF:'
```

## 5. 固件描述错误的症状

- MMIO 范围冲突，probe 申请资源失败。
- IRQ 类型/编号错误，设备无 completion 或中断风暴。
- DMA coherency/IOMMU 属性错误，数据损坏。
- clock/reset/power-domain 缺失，设备 ID 可见但不能工作。

驱动升级后失败不一定是驱动回归，也可能新驱动开始严格验证旧固件中的错误描述。

## 6. 练习与答案

**问题：Device Tree 是否由 Linux 专用？**

答案：不是。它是硬件描述格式，可由 Bootloader 和不同操作系统消费；Linux 只是其中之一。

**问题：PCIe 设备还需要 ACPI/DT 吗？**

答案：PCIe endpoint 可被枚举，但 Host Bridge、窗口、IOMMU、中断路由和电源关系仍可能由固件描述。

下一篇：[PCIe 枚举、BAR、拓扑与资源分配](./03-PCIe枚举-BAR拓扑与资源分配.md)
