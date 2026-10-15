---
title: "AC、DC、HVDC、母线、BBU 与机柜供电架构"
sidebar_label: "05. 机柜与服务器供电架构"
sidebar_position: 5
description: "从市电、UPS、PDU、机柜 Power Shelf 和 Busbar 到服务器 PSU、BBU 与 VRM，解释 AC/DC/HVDC、12V/48V、冗余和功率容量规划。"
tags: [AC, DC, HVDC, UPS, BBU, Busbar, PSU, Power Shelf]
---

# AC、DC、HVDC、母线、BBU 与机柜供电架构

服务器的电力路径可能是“机柜交流输入、每台服务器独立 PSU”，也可能是“机柜集中 Power Shelf 转为 48V DC，再经 Busbar 供给节点”。两种架构的转换级数、冗余、维护和故障域不同。

## 1. 传统 AC 路径

```text
Utility / Generator
→ Transformer / Switchgear
→ UPS
→ PDU / RPP
→ Rack PDU
→ Server PSU A/B
→ 12V/48V Board Rail
→ VRM / POL
→ CPU、GPU、DIMM、NIC
```

每一级都有容量、效率、保护和冗余边界。

## 2. AC 与 DC

- AC：方向周期变化，便于变压和传统配电；
- DC：方向固定，适合电子设备内部和机柜母线；
- PSU：通常把 AC 转成服务器需要的 DC；
- DC-DC Converter/VRM：继续降压到芯片电压。

设备标注 `200–240 VAC`、`48 VDC` 或其他范围时，必须匹配供电类型、连接器、极性、接地和保护。

## 3. HVDC 与 LVDC

数据中心可能采用较高电压 DC 进行传输，再在靠近负载处转换。提高电压可以在相同功率下降低电流：

```text
P = V × I
Ploss = I² × R
```

同样功率下，从 12V 提升到 48V，理想电流降为四分之一，导体损耗按电流平方显著降低。

HVDC 并不是“直接把高压接到主板”，仍需隔离、保护、Connector、Converter 和安全规范。

## 4. 分布式 PSU 架构

传统服务器每台拥有 PSU：

```text
Rack PDU A ─→ PSU A ┐
                    ├→ Server Power Board → VRM
Rack PDU B ─→ PSU B ┘
```

优势：

- 服务器自治；
- 更换边界清楚；
- 兼容传统机架。

代价：

- 每台重复 AC-DC 转换和冗余；
- 低负载时效率可能下降；
- PSU 占用机箱空间和风道。

## 5. Power Shelf 与 Busbar

开放机架/高密度架构可把 AC-DC 转换集中到机柜 Power Shelf：

```text
AC Feed A/B
→ Power Shelf：PSU Module × N
→ 48V DC Busbar
→ Blind-mate Connector
→ IT Tray DC-DC
→ Board Rail / VRM
```

优点：

- 提高机柜级转换效率；
- 减少每节点 PSU；
- 便于集中冗余和监控；
- Busbar 支持高电流分配。

风险：Power Shelf、Busbar 和公共 Connector 成为机柜级故障域，必须设计隔离和冗余。

## 6. UPS 与 BBU

### 6.1 UPS

UPS 通常位于设施级或机房级，为一组负载提供停电 Ride-through，等待发电机接管或安全关机。

### 6.2 BBU

Battery Backup Unit 可位于机柜 Power Shelf，针对机柜或一组 IT Tray 提供短时间备电。

```text
Utility 失电
→ UPS/BBU 立即接管
→ Generator 启动或负载有序退出
```

UPS/BBU 容量要按功率、时间、老化、温度和转换效率计算。标称电池容量不等于目标功率下的实际可用时间。

## 7. 冗余模型

| 模型 | 含义 | 说明 |
| --- | --- | --- |
| N | 刚好满足负载 | 无冗余 |
| N+1 | 多一个模块 | 单模块故障仍满足 N |
| N+N | 两组完整容量 | 可形成 A/B 路 |
| 2N | 两套独立完整系统 | 成本和隔离要求高 |
| 2N+1 | 双系统外再加额外模块 | 极高冗余 |

“双 PSU”只有连接到真正独立的 A/B PDU、UPS 和上游 Feed，才形成端到端冗余。

## 8. 负载共享与降级

两个 PSU 同时工作时可能均流。单 PSU 故障后，剩余 PSU 需要承受全部负载：

```text
正常：2 × 1600W PSU，各承载约 900W
故障：1 × 1600W PSU 承载约 1800W → 过载
```

因此 PSU 总额定大于负载不等于冗余成立。必须在失去一条路径后仍满足峰值、瞬态和环境降额。

## 9. 峰值、瞬态和浪涌

- Steady-state：长期平均功耗；
- Peak：短时间高负载功耗；
- Transient：微秒到毫秒级快速变化；
- Inrush：上电时电容充电浪涌。

GPU/NPU 负载可能快速改变功率。PSU、BBU、Busbar、VRM 和保护阈值都要能承受瞬态，而不只是平均功耗。

## 10. VRM 与 Point-of-load

VRM 把 12V/48V 等板级电压转换为 CPU/GPU 所需的低电压大电流：

```text
Board Rail
→ Multi-phase VRM
→ CPU/GPU Core Rail
```

多相设计分担电流和纹波。VRM 过热、相位故障或电流限制可能导致 CPU/GPU 降频、重启或 Power Good 丢失。

## 11. Power Capping

功率上限可位于多个层次：

- CPU Package Limit；
- GPU Power Limit；
- BMC Node Power Cap；
- Rack Power Shelf Limit；
- Data Center Demand Response。

```text
机柜功率不足
→ 设置节点/GPU Cap
→ 避免上游保护跳闸
→ 代价是频率或吞吐下降
```

容量规划应显式建模 Cap 对业务 SLO 的影响。

## 12. 效率曲线

PSU 效率不是固定值：

```text
Efficiency = DC Output Power ÷ AC Input Power
```

过低负载、过载、温度和输入电压都会影响效率。N+1 方案还要考虑各 PSU 在正常和故障状态的负载点。

## 13. 监控与证据

```bash
ipmitool sdr type 'Power Supply'
ipmitool sdr type Current
ipmitool sdr type Voltage
ipmitool sel elist
```

机柜侧还应采集：

- A/B Feed 电压、电流、功率和能量；
- 相位负载；
- PDU Branch Circuit；
- Power Shelf PSU/BBU 状态；
- Busbar/Connector 温度；
- BBU State of Charge/Health；
- 节点/GPU Power Cap 和 Throttling。

## 14. 常见故障

| 现象 | 优先检查 |
| --- | --- |
| 高负载整机重启 | PSU/VRM/瞬态、Power Cap、连接器 |
| 一排节点同时掉电 | Rack PDU、Busbar、Power Shelf |
| 单 PSU 告警但业务正常 | 冗余已丢失，剩余容量是否足够 |
| BBU 自检失败 | 电芯老化、温度、控制器、充电状态 |
| Connector 过热 | 接触电阻、松动、污染、过流 |
| GPU 频率下降 | GPU Cap、机柜 Cap、温度或 VRM |

## 15. 选型和容量规划

1. 统计每节点 Idle、Typical、Peak 和 Transient；
2. 计算失去一个 PSU/Feed 后的容量；
3. 加入温度降额、老化和未来扩容；
4. 平衡三相和 A/B PDU；
5. 验证 UPS/BBU Ride-through 时间；
6. 评估 12V/48V 和分布式/集中转换；
7. 压测 CPU/GPU/NIC/NVMe 同时满载；
8. 演练单 PSU、单 Feed 和 BBU 故障。

## 16. 练习与答案

**问题：一台服务器配置两块 2kW PSU，能否支持 3kW 峰值并保持冗余？**

答案：不能。两块并联时总容量可能够，但任意一块故障后剩余 2kW 无法承载 3kW，不能称为峰值下的 N+1。

**问题：为什么 48V 配电比 12V 更适合高功率机柜？**

答案：相同功率下电流约降为四分之一，理想导体 `I²R` 损耗显著降低，也可减小母线截面积；但仍需匹配转换、连接器和安全设计。

## 17. 参考资料

- [Open Compute Project：Rack & Power](https://www.opencompute.org/projects/rack-and-power/)
- [Open Compute Project：Open Rack V3](https://www.opencompute.org/contribution-family/openrack-v3/)
