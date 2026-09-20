---
title: "PCIe 枚举、BAR、拓扑与资源分配：设备为什么能被 CPU 找到"
sidebar_label: "03. PCIe 枚举、BAR 与拓扑"
sidebar_position: 3
description: "解释 BDF、配置空间、BAR、Bridge 窗口、链路宽度、NUMA、ACS 和 Linux PCI 资源树。"
tags: [Linux, PCIe, BAR, BDF, NUMA]
---

# PCIe 枚举、BAR、拓扑与资源分配：设备为什么能被 CPU 找到

PCIe 是点到点分层互连。CPU 并非直接“看到显卡或网卡内存”，而是通过 Root Complex、Bridge/Switch 和配置空间发现功能，再把 BAR 映射进系统地址空间。

## 1. BDF 与拓扑

`0000:65:00.1` 表示 domain:bus:device.function。一个物理设备可暴露多个 function；桥会建立下级 bus 编号范围。

```bash
lspci -Dnn
lspci -tv
lspci -s 0000:65:00.1 -vv
readlink -f /sys/bus/pci/devices/0000:65:00.1
cat /sys/bus/pci/devices/0000:65:00.1/numa_node
```

## 2. 枚举过程

```text
固件/内核发现 Host Bridge
→ 扫描 bus/device/function 配置空间
→ 识别 Vendor/Device/Class/Capabilities
→ 递归配置 Bridge 的 bus 与资源窗口
→ 为 endpoint BAR 分配 MMIO/IO 地址
→ 创建 pci_dev 并匹配驱动
```

BAR 只声明设备需要的窗口类型和大小，系统分配 CPU 侧地址。64-bit prefetchable BAR、Resizable BAR 和桥窗口会影响大设备资源布局。

## 3. 链路能力与当前状态

`LnkCap` 是最大能力，`LnkSta` 是协商后的当前速度/宽度。设备支持 x16 Gen5，但插槽布线、Switch、BIOS、信号质量或降速可能使当前只有 x8/Gen4。

吞吐还受编码、协议开销、请求大小、NUMA 和对端限制，不能直接用 `GT/s × lane` 当应用带宽。

## 4. Bridge、Switch 与 ACS

同一 PCIe Switch 下设备可能支持 P2P，但是否直达取决于拓扑、ACS 重定向、IOMMU、驱动和平台。`lspci -tv` 只给逻辑拓扑，无法单独证明实际数据一定不经 Root Complex。

## 5. 资源失败

```bash
dmesg -T | grep -Ei 'pci|bar|resource|aer'
cat /proc/iomem
lspci -vv | grep -E '^[0-9a-f]|Region|LnkSta|AER' -A2
```

常见问题包括 64-bit MMIO 窗口不足、Bridge window 太小、Above 4G decoding 未启用、AER 链路错误、设备落在远端 NUMA Node。

## 6. SR-IOV

Physical Function 可创建多个 Virtual Function。VF 是真实 PCI function，有独立 BDF 和 IOMMU 隔离边界，但配置、队列和性能资源仍由 PF/硬件共享。

## 7. 练习与答案

**问题：两个 GPU 的 BDF bus number 相邻，是否表示它们物理上相邻？**

答案：不保证。要结合桥树、slot、NUMA、厂商拓扑工具和板级设计。

**问题：BAR 等于设备全部显存吗？**

答案：不一定。BAR 是主机访问设备资源的窗口；其大小与映射策略可不同于设备本地内存总量。

下一篇：[内核模块、符号、依赖与驱动绑定](./04-内核模块符号依赖与驱动绑定.md)
