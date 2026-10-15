---
title: "RAS、MCE、EDAC、AER、SMART 与 SEL 证据链"
sidebar_label: "01. 跨层硬件错误证据链"
sidebar_position: 1
description: "统一理解 CPU Machine Check、EDAC、PCIe AER、SMART/NVMe Health、BMC SEL 的来源、时间和关联方式。"
tags: [RAS, MCE, EDAC, AER, SMART, SEL]
---

# RAS、MCE、EDAC、AER、SMART 与 SEL 证据链

不同日志观察的是同一次故障的不同阶段。BMC 可能记录 PSU 或温度事件，CPU Machine Check 记录总线/内存错误，Kernel AER 记录 PCIe 层异常，设备日志再记录内部 Reset。正确做法是关联，而不是从任意一条日志直接得出换件结论。

## 1. Corrected 与 Uncorrected

- Corrected：硬件通过 ECC、Retry、Replay 等机制恢复了本次错误；
- Uncorrected：本层无法恢复，可能向上报告；
- Recoverable/Non-Fatal：事务受影响，但系统或设备可能通过 Reset 恢复；
- Fatal：继续运行可能不可靠，需要隔离或重启。

不同子系统术语不完全相同，应按其规范解释，不能把所有 `corrected` 统一当成同一严重性。

## 2. CPU Machine Check / MCA

CPU Machine Check Architecture 可报告：

- Core/Cache/TLB 错误；
- Memory Controller 与内存通道错误；
- Interconnect 错误；
- 部分 I/O 和总线错误。

原始 Bank、Status、Address、Syndrome 需要结合 CPU Family/Model、EDAC/RAS 工具和厂商解码。日志中的 CPU 编号是逻辑处理器，不一定等于故障物理部件位置。

## 3. EDAC

Linux EDAC 框架聚合内存和部分硬件纠错信息。内存错误定位可能涉及：

```text
Physical Address
→ Memory Controller
→ Channel
→ DIMM Slot
→ Rank/Bank/Chip（取决于平台能力）
```

有些平台由 Firmware First（如 GHES/APEI）上报，有些由 OS EDAC Driver 直接读取。两者重复或缺失都需要理解平台路径。

## 4. PCIe AER 与 DPC

AER 提供 Receiver Error、Bad TLP/DLLP、Replay、Unsupported Request 等证据。排查需要同时查看：

- Endpoint 与上游 Root Port/Switch；
- Correctable、Non-Fatal、Fatal；
- 链路 Speed/Width 和是否 Recovery；
- DPC 是否隔离了下游；
- 驱动是否随后 Function/Bus Reset。

AER 报在 Root Port 上，不等于 Root Port 一定是物理根因；它可能只是第一个能报告下游错误的组件。

## 5. SMART 与 NVMe Health

ATA/SAS SMART 和 NVMe Health 可提供：

- 温度、上电时间、写入量；
- 介质/数据完整性错误；
- 备用空间和寿命消耗；
- Unsafe Shutdown；
- 错误日志和 Critical Warning。

字段 ID 和单位可能由厂商定义，必须结合型号文档和基线。`PASSED` 不能覆盖错误日志中不断增长的 Timeout 或介质错误。

## 6. BMC SEL

SEL 适合记录平台事件：

- PSU AC Lost、Power Fault；
- Fan Failure、温度阈值；
- Voltage/Current 异常；
- DIMM/CPU/PCIe 平台事件；
- Chassis Intrusion、Watchdog、Reset Reason。

BMC 时钟可能未同步，传感器名也可能不精确。关联前先校正 BMC、OS、交换机和监控时间。

## 7. 时间线关联

```text
10:02:14 BMC：PSU 输入瞬断
10:02:14 Kernel：PCIe Link Down / AER
10:02:15 Driver：NVMe Controller Reset
10:02:16 Application：I/O Timeout
```

这里应用 Timeout 是末端现象，NVMe Reset 也可能只是供电波动的结果。若只看到最后一条就换 SSD，问题会复发。

## 8. 地址、槽位与序列号映射

建议长期维护：

| 逻辑对象 | 硬件身份 |
| --- | --- |
| CPU/NUMA/Memory Controller | Socket 与主板位置 |
| EDAC Channel/DIMM Label | DIMM 槽位和序列号 |
| PCI BDF | Root Port、Riser、物理 Slot |
| `/dev/nvmeXnY` | Controller Serial、Namespace、Bay |
| NIC Interface | PCI BDF、Port、模块、交换机端口 |

Linux 名称和 BDF 可能在固件/拓扑变化后改变，序列号和物理标签用于持久身份。

## 9. 常用证据入口

```bash
journalctl -k --since '-2 hours'
dmesg -T | grep -Ei 'mce|hardware error|edac|aer|dpc|nvme|reset'
ras-mc-ctl --errors
lspci -vv
smartctl -x /dev/sdX
nvme smart-log /dev/nvme0
ipmitool sel elist
ipmitool sensor list
```

工具是否可用、字段是否完整取决于平台。采集命令本身也不能替代厂商诊断包和原始日志。

## 10. 趋势与阈值

建立每型号、每固件和每负载的正常基线：

- 累计值与单位时间增量分开；
- 节点重启/计数清零要标记；
- 同批次节点做横向比较；
- 错误速率与温度/负载关联；
- 采用厂商更换阈值，但对关键业务可设更早预警。

## 11. 练习与答案

**问题：Root Port 报 AER，为什么不能直接更换主板？**

答案：Root Port 可能是在报告下游 Endpoint、Riser、Retimer 或链路产生的错误。需要沿拓扑检查并做交叉替换。

**问题：BMC SEL 时间比 OS 日志晚八小时，怎样处理？**

答案：先确认时区、RTC/NTP 和 BMC 时间源，转换到统一时间轴后再关联，不能按显示字符串直接排序。
