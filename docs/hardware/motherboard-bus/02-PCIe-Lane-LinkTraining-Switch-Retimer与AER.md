---
title: "PCIe Lane、链路训练、Switch、Retimer 与 AER"
sidebar_label: "02. PCIe 链路、Switch 与 AER"
sidebar_position: 2
description: "深入理解 PCIe Lane、Link、LTSSM、速率宽度协商、Switch、Retimer、Bifurcation、AER 与链路故障定位。"
tags: [PCIe, Lane, LTSSM, Retimer, AER]
---

# PCIe Lane、链路训练、Switch、Retimer 与 AER

PCIe 设备“能识别”并不代表链路健康。设备可能以更低代际或更窄宽度运行，也可能因重传、链路恢复和 AER 错误产生尾延迟。排查时必须同时看能力、当前状态、拓扑和错误计数。

## 1. Lane、Link 与方向

一条 PCIe Lane 由发送和接收差分对组成，支持全双工。多条 Lane 可组合为 x1、x2、x4、x8、x16 等 Link：

```text
Root Port Tx ─────────────→ Endpoint Rx
Root Port Rx ←───────────── Endpoint Tx

x8 Link = 8 组双向 Lane 协同工作
```

“机械 x16”只描述插槽长度；实际可能只布线 x8，或与其他槽位共享并由 BIOS 分叉。判断有效能力必须看主板手册和 `LnkCap/LnkSta`。

## 2. 速率不等于有效吞吐

PCIe 标注的 GT/s 是每 Lane 每秒传输次数，不是应用可直接获得的 GB/s。有效吞吐还会扣除：

- 线路编码和物理层开销；
- TLP/DLLP Header、CRC 与 Ack；
- Payload 大小与读请求大小；
- 协议往返、流控 Credit；
- IOMMU、DMA 映射与软件队列；
- 链路重传、NUMA 与上游共享。

估算时先算“每 Lane 有效位率 × Lane 数”，再根据负载类型扣除协议和系统开销。不要把 GT/s 直接当 GB/s。

## 3. PCIe 拓扑中的角色

| 角色 | 作用 |
| --- | --- |
| Root Complex | CPU/SoC 与 PCIe 层次的起点 |
| Root Port | Root Complex 对外的一个端口 |
| Endpoint | NIC、GPU、NVMe 等功能设备 |
| PCIe Switch | 一个或多个上行/下行端口之间交换 TLP |
| Bridge | 连接不同 PCI Bus 层次并转发事务 |
| Retimer | 重建高速信号并重新定时，延长可达距离 |
| Redriver | 放大和均衡模拟信号，但不完整重建协议时序 |

Switch 解决端口扩展与转发，Retimer 解决信号完整性，二者不能互相替代。

## 4. 链路训练在做什么

上电、复位或恢复过程中，两端通过 LTSSM（Link Training and Status State Machine）建立链路。简化过程：

```text
Detect
→ Polling
→ Configuration
→ L0 正常工作
↘ Recovery（重新均衡、降速或恢复）
```

训练会完成：

- 检测对端；
- 确定 Lane 数和 Lane 映射；
- 协商双方都支持的速度与宽度；
- 完成均衡和接收参数调整；
- 进入可正常传输的 L0 状态。

如果高代际训练不稳定，链路可能回退到更低速度；某些 Lane 异常时也可能降宽。于是设备仍可用，但吞吐降低或错误增加。

## 5. Link Capability 与 Link Status

```bash
lspci -s 65:00.0 -vv
```

典型关注字段：

```text
LnkCap: Port #0, Speed 16GT/s, Width x16
LnkSta: Speed 8GT/s (downgraded), Width x8 (downgraded)
```

- `LnkCap`：该端口自身宣称的最大能力；
- `LnkSta`：当前协商结果；
- `downgraded`：当前低于能力，但不直接说明哪一端或哪一段导致；
- 上游 Root Port/Switch 端口也要检查，不能只看 Endpoint。

设备和上游支持能力不同，最终取双方及中间器件共同可用的最低条件。

## 6. Bifurcation 与插槽共享

Bifurcation 把一个宽 Root Port 分成多个独立端口，例如：

```text
x16 → x8 + x8
x16 → x4 + x4 + x4 + x4
```

它需要 CPU、BIOS、Riser/背板和设备形态共同匹配。常见故障是：

- 一张四盘 NVMe 转接卡只识别第一块盘；
- 插入第二张卡后第一张卡从 x16 变为 x8；
- BIOS 更新或恢复默认值后设备消失；
- Slot 外形相同，电气 Lane 和归属不同。

PCIe Switch 型转接卡和无 Switch 的被动分叉卡原理不同，不能混用配置。

## 7. Switch 上行共享与 P2P

同一 Switch 下的两个 Endpoint 在硬件上具备较短路径，但能否进行 Peer-to-Peer 还取决于：

- 设备是否支持 P2P；
- ACS 是否强制事务上行到 Root Complex；
- IOMMU 分组与隔离策略；
- 驱动、Kernel 和虚拟化配置；
- Switch 与平台的路由能力。

“同一 Switch”不等于数据一定绕过 CPU，也不等于应用自动使用 P2P。CPU 可能只负责提交控制命令，而数据由 DMA 直达；也可能因平台策略绕经 Root Complex。

## 8. Retimer、线缆与信号完整性

高速代际对走线损耗、连接器、Riser、背板和线缆更敏感。Retimer 接收并恢复信号后重新发送，可打断信号损耗预算。问题可能表现为：

- 冷启动偶发不枚举；
- 高速时 AER 增加，强制降代后稳定；
- 链路反复进入 Recovery；
- 某温度或满载状态下错误增加；
- 更换 Riser/线缆或更新 Retimer 固件后恢复。

强制降速可以作为隔离实验，但不能当作最终修复。它只能证明问题与高速链路路径相关。

## 9. AER 与 DPC

AER（Advanced Error Reporting）让 PCIe 层报告更细的错误。常见分类：

| 类型 | 含义 | 示例 |
| --- | --- | --- |
| Correctable | 硬件已纠正，业务可能继续 | Replay、Bad DLLP、Receiver Error |
| Uncorrectable Non-Fatal | 事务受影响但链路未必失效 | Unsupported Request 等 |
| Uncorrectable Fatal | 链路/层次可能无法继续可靠工作 | 严重协议或链路错误 |

DPC（Downstream Port Containment）会在严重错误时隔离下游，防止故障扩散。结果可能是设备突然消失，随后由热复位或驱动恢复。

一次 Correctable 事件不等于硬件报废；持续增长、与负载同步或同时出现降速/重置才更有诊断价值。

## 10. 分层排障流程

```bash
# 1. 记录拓扑
lspci -tv

# 2. 同时查看 Endpoint 和上游端口
lspci -s 65:00.0 -vv
lspci -s 64:00.0 -vv

# 3. 观察 Kernel 事件
dmesg -T | grep -Ei 'pcie|aer|dpc|link down|reset'

# 4. 查看驱动与 NUMA
lspci -s 65:00.0 -nnk
cat /sys/bus/pci/devices/0000:65:00.0/numa_node
```

建议按以下顺序收敛：

1. 核对型号、槽位、电气规格和 Lane 分叉；
2. 比较 `LnkCap` 与 `LnkSta`；
3. 查看上游每一级 Bridge/Switch；
4. 关联 AER、DPC、设备 Reset 和业务时间；
5. 进行可回退的换槽、换 Riser、交换卡、降速隔离；
6. 核对 BIOS、BMC、CPLD、Retimer 和设备固件矩阵；
7. 修复后进行重启、冷启动和持续压力回归。

## 11. 练习与答案

**问题：设备在 `lspci` 中存在，能否排除 PCIe 硬件问题？**

答案：不能。它只能证明当前完成了枚举。链路仍可能降速、降宽、重传或在压力下进入 Recovery。

**问题：把 PCIe 速度从高代际降一档后错误消失，能否直接认定设备芯片损坏？**

答案：不能。问题范围包括设备、连接器、Riser、背板、Retimer、Root Port、固件和板级信号完整性。应通过交换部件和拓扑对照继续定位。

延伸阅读：[PCIe 枚举、BAR、拓扑与资源分配](../../linux/system-internals/09-devices-drivers/03-PCIe枚举-BAR拓扑与资源分配.md)。
