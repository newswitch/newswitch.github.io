---
title: "BIOS、BMC、CPLD、微码与设备固件分层"
sidebar_label: "01. 服务器固件分层"
sidebar_position: 1
description: "解释 BIOS/UEFI、BMC、CPLD、CPU 微码、Option ROM 和 PCIe 设备固件的职责、加载顺序和故障边界。"
tags: [BIOS, UEFI, BMC, CPLD, Microcode, Option ROM]
---

# BIOS、BMC、CPLD、微码与设备固件分层

“固件问题”不是一个故障层。不同固件分别控制供电、板级状态机、CPU 初始化、设备启动和带外管理。定位前先确认是哪段代码、在哪个处理器上、何时运行。

## 1. 固件地图

| 固件 | 运行位置 | 主要职责 |
| --- | --- | --- |
| BIOS/UEFI | 主 CPU 启动环境 | CPU/内存/PCIe 初始化、启动设备与 OS |
| BMC Firmware | BMC SoC | 带外管理、传感器、电源、KVM、Redfish/IPMI |
| CPLD/FPGA | 板级逻辑器件 | 上电时序、Reset、Mux、Presence、Glue Logic |
| CPU Microcode | CPU 内部控制层 | 修正或调整处理器内部行为 |
| Option ROM/UEFI Driver | PCIe 设备或系统固件 | Pre-boot 设备初始化、PXE/RAID/GPU Console |
| Device Firmware | NIC/SSD/GPU/HBA 等控制器 | 设备队列、协议、介质和错误恢复 |

## 2. 上电与加载顺序

简化顺序：

```text
待机电源
→ BMC/CPLD 启动
→ 电源时序和 Reset
→ CPU 从 Reset Vector 执行 UEFI
→ CPU Microcode、Memory Training
→ PCIe 枚举与 Option ROM
→ Bootloader
→ Kernel 再加载可用的 Microcode/Device Firmware
→ Driver 绑定
```

不同阶段失败，能看到的日志不同。Memory Training 之前故障通常没有 OS 日志，需要 POST Code、串口和 BMC SEL。

## 3. BIOS/UEFI 配置影响

常见平台配置包括：

- NUMA/SNC/NPS；
- Memory Speed、RAS、Patrol Scrub；
- PCIe Generation、Bifurcation、Above 4G Decoding；
- SR-IOV、IOMMU、ACS；
- CPU C-State、P-State、Turbo、Power Profile；
- Secure Boot、TPM、Boot Order；
- Fan/Power Policy。

升级或恢复默认值可能改变这些配置。上线前应导出并比较，而不是只记录 BIOS 版本。

## 4. BMC 的独立边界

BMC 可在主机 OS 宕机时继续工作，但也可能自身出现：

- 管理接口卡死；
- 传感器读数异常；
- SEL 时间漂移；
- Redfish/IPMI 服务不响应；
- 风扇策略和 Inventory 不正确；
- BMC Reset 期间短暂失去带外能力。

BMC 重启通常不等于主机重启，但具体平台可能影响风扇、KVM 或传感器，生产前必须确认。

## 5. CPLD 与板级依赖

CPLD 固件常与主板 Revision、Riser 或背板相关。错误版本可能导致：

- 某槽位不供电或 Presence 错误；
- Power Sequence/Reset 异常；
- 风扇、LED、Hot-plug 行为错误；
- BMC 无法读取特定传感器；
- PCIe 设备在冷启动和热重启表现不同。

CPLD 升级失败的恢复能力有限，应优先使用厂商 Bundle 和明确的断电步骤。

## 6. CPU Microcode

Microcode 可由 BIOS 早期加载，也可由 OS 在启动时更新。它用于修复处理器 Errata 和安全问题，可能影响性能计数、功耗或某些指令行为。

需要同时记录：

- CPU 型号/Stepping；
- BIOS 内置 Microcode；
- OS 包和 Kernel 实际加载版本；
- 更新是否需要重启；
- 集群节点是否一致。

## 7. Option ROM 与设备固件

Option ROM 主要服务 Pre-boot，例如 PXE、RAID 配置和启动磁盘发现。设备 Firmware 则在运行时管理硬件。两者可能同包发布，也可能独立更新。

大量启用 Option ROM 会增加启动时间或耗尽固件资源；不需要从某设备启动时，可按厂商建议关闭其 Pre-boot 功能，但不能因此关闭 OS 所需设备本身。

## 8. 双镜像与恢复

部分平台提供 A/B Bank、Golden Image 或 Recovery Mode：

```text
Active Bank 更新失败
→ Boot ROM 验证失败
→ 切换 Recovery/Backup Bank
→ 管理面重新刷写
```

不要假设所有组件都有双镜像。升级前必须明确：失败后能否由 BMC 恢复、是否需要现场 Jumper/编程器、是否会丢失配置。

## 9. 证据采集

```text
机型、主板 Revision、序列号
BIOS/BMC/CPLD/PSU/Backplane 版本
CPU Microcode
NIC/NVMe/GPU/HBA/Retimer 固件
BIOS 配置导出
BMC SEL 与更新任务日志
OS Driver、Kernel 与 Runtime
```

版本必须和具体硬件实例绑定，不能只写“集群已升级”。

## 10. 练习与答案

**问题：OS 中驱动相同，为什么两台同型号服务器 PCIe 拓扑不同？**

答案：可能存在 BIOS 配置、CPLD/Riser、主板 Revision 或固件版本差异，设备枚举发生在驱动绑定之前。

**问题：BMC 能远程 KVM，是否说明 BIOS 一定正常？**

答案：不能。BMC 是独立 SoC，KVM/管理面可正常，而主 CPU 仍可能卡在 Memory Training、PCIe 初始化或 UEFI 阶段。
