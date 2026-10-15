---
title: "固定式、模块化交换机、线卡、主控与交换 Fabric"
sidebar_label: "04. 交换机形态与内部组件"
sidebar_position: 4
description: "从固定盒式与模块化机框出发，解释线卡、Supervisor、Fabric Module、PHY、光口、Breakout、交换容量、冗余和选型。"
tags: [交换机, 线卡, Supervisor, Fabric, ASIC, Breakout]
---

# 固定式、模块化交换机、线卡、主控与交换 Fabric

交换机不只是“很多网口加一颗 ASIC”。固定盒式交换机把端口、ASIC、CPU 和电源装在一个机箱里；模块化机框则把线卡、主控、交换 Fabric、电源和风扇拆成多个可替换模块。两者的扩展、冗余和故障域不同。

## 1. 按机械形态分类

| 形态 | 结构 | 优点 | 限制 |
| --- | --- | --- | --- |
| 固定盒式 | 端口和 ASIC 固定在 1U/2U | 延迟低、部署简单、成本可控 | 端口类型和容量难扩展 |
| 模块化机框 | Slot 插入线卡、主控和 Fabric | 高密度、冗余、可在线维护 | 成本、功耗和复杂度高 |
| 白盒交换机 | 标准硬件配开放/可选 NOS | 软硬解耦和自动化 | 兼容、支持和生命周期要自行治理 |
| 专用 Fabric Switch | InfiniBand、NVLink 等专用互联 | 面向特定语义和拓扑 | 不能等同普通 Ethernet Switch |

Leaf、Spine、ToR、EoR 描述网络角色或位置，不是严格硬件类别。

## 2. 固定盒式交换机内部

```text
Front-panel Ports
→ PHY / SerDes / Gearbox
→ Switching ASIC
   ├── Packet Buffer
   ├── Parser / Match-Action
   ├── L2/L3/ACL Table
   └── Queue / Scheduler
→ Management CPU
→ SSD/eMMC / BMC/CPLD
→ PSU / Fan Tray
```

某些平台由 ASIC SerDes 直接连接光模块，另一些需要 PHY/Retimer/Gearbox 完成速率或信号转换。

## 3. 模块化机框内部

```text
Line Card A ─┐
Line Card B ─┼→ Fabric Module × N → Line Card C/D
Line Card C ─┘
        ↕
Supervisor / Route Processor × N
        ↕
Management、Clock、Power、Fan
```

### 3.1 Line Card

线卡包含前面板 Port、PHY/SerDes，可能还有本地转发 ASIC 和 Buffer。它把报文送往本地端口或机框 Fabric。

### 3.2 Supervisor/Route Processor

主控运行 NOS 的控制和管理平面：

- Routing Protocol；
- FIB/ACL 下发；
- Chassis 管理；
- CLI/API/Telemetry；
- Firmware 和 HA 状态。

### 3.3 Fabric Module

Fabric Module 在各 Line Card 之间提供高速互联。多个 Fabric Module 可形成容量和冗余，失去一个模块后交换机可能保持转发但降低总带宽。

## 4. Distributed 与 Centralized Forwarding

- Centralized：主要查表和转发集中在中央 ASIC；
- Distributed：每块 Line Card 有本地转发能力，Fabric 负责跨卡传输；
- Hybrid：不同阶段由线卡和中心模块协作。

模块化机框的控制平面可以集中，而数据平面仍然分布式。主控切换不应自动等同于所有硬件转发表消失，但实际行为取决于平台设计。

## 5. Merchant Silicon、自研 ASIC 与 FPGA

| 方案 | 主要特点 |
| --- | --- |
| Merchant Silicon | 标准 ASIC 生态、上市快、通用功能丰富 |
| Vendor Custom ASIC | 可针对产品特性和规模定制 |
| FPGA | 灵活但吞吐、功耗、成本和开发复杂度需权衡 |
| NPU/Programmable ASIC | 提供更强可编程 Pipeline |

同一颗 Merchant Silicon 在不同厂商设备上，因 Buffer、Port Wiring、NOS 和 Hardware Profile 不同，实际能力仍可能不同。

## 6. Port、SerDes 与 Breakout

一个高速前面板 Port 可能由多条 SerDes Lane 组成。Breakout 是把 Lane 重新组合为多个较低速逻辑 Port：

```text
1 × 400G
↔ 多条高速 Lane
↔ 4 × 100G 或其他受支持模式
```

必须同时满足：

- ASIC Port Group 支持；
- Front-panel Connector 和 Cable 支持；
- NOS Port Profile 正确；
- FEC/Auto-negotiation 匹配；
- 相邻 Port 没有因 Lane 共享被禁用。

## 7. 交换容量怎样理解

厂商常标注 Switching Capacity、Forwarding Rate 和 Port Bandwidth。需要区分：

```text
端口单向带宽总和
双向全双工带宽
Fabric 内部带宽
最小包 PPS
Packet Buffer 与表项资源
```

一台交换机可以线速转发大包，却在最小包 PPS、ACL Recirculation 或跨 Fabric 流量下达到瓶颈。

## 8. Oversubscription

### 8.1 端口层

48 个 25G Downlink 加 6 个 100G Uplink：

```text
Downlink = 48 × 25G = 1200G
Uplink   = 6 × 100G = 600G
Oversubscription = 2:1
```

### 8.2 机框 Fabric 层

Line Card 前面板带宽还可能超过其 Fabric 上行。判断无阻塞不能只看机框宣传值，要确认安装了多少 Fabric Module、处于什么冗余模式。

## 9. Buffer 架构

- On-chip Shared Buffer：延迟低、容量有限；
- Deep Buffer：适合速率转换、长距离和突发；
- Distributed Buffer：分布在线卡/ASIC；
- VOQ：在入口按出口排队，降低 Head-of-Line Blocking。

AI Fabric 的微突发、All-to-All 和 Incast 对 Buffer/ECN 调优尤其敏感。

## 10. 冗余不等于零影响

| 冗余部件 | 故障后可能结果 |
| --- | --- |
| 双 PSU | 业务继续，但剩余 PSU 可能超载 |
| 双 Supervisor | 控制平面切换，协议可能短暂抖动 |
| 多 Fabric Module | 继续转发但容量下降 |
| 多 Fan Tray | 温度升高、风扇全速或关机保护 |
| MLAG 双机 | 单机失效可切换，但 Peer Link/配置仍是风险 |

需要在降级状态下重新计算功率、Fabric 和上行带宽。

## 11. Airflow 与 Port-side

常见气流方向：

- Port-side Intake；
- Port-side Exhaust。

同一机柜混用方向会造成热风回流。PSU、Fan Tray 和机箱必须匹配气流方向，不能只更换风扇模块颜色相近的部件。

## 12. 管理和启动组件

交换机内部也有完整计算系统：

- Management CPU；
- DRAM；
- eMMC/SSD；
- BIOS/Bootloader；
- BMC/CPLD；
- NOS；
- ASIC SDK/Driver/Firmware。

所以“管理口能 Ping”不能证明 ASIC 数据面正常；反过来，NOS 崩溃时部分硬件表项也可能暂时继续转发。

## 13. 观测与资产映射

不同 NOS 命令不同，但应收集：

```text
Chassis / Line Card / Supervisor / Fabric 状态
Port Lane / Speed / FEC / Optics DOM
ASIC、Buffer、TCAM 和 Queue 水位
PSU、Fan、温度与 Airflow
Firmware、NOS、SDK 和硬件版本
Fabric CRC、SerDes BER 与模块事件
```

模块化机框排障要记录 Slot，不能只写“交换机丢包”。

## 14. 选型流程

1. 定义端口速率、数量、介质和未来增长；
2. 计算最小包 PPS 和真实 Oversubscription；
3. 估算 Route、MAC、ARP/ND、ACL 和 Tunnel 表项；
4. 根据突发模型选择 Buffer；
5. 明确固定式还是模块化，以及冗余后的容量；
6. 核对 NOS、Telemetry、自动化和升级策略；
7. 检查机柜深度、气流、功率、光纤和 Breakout；
8. 用真实报文大小、ECMP 和故障切换验收。

## 15. 练习与答案

**问题：模块化交换机有六块 Fabric Module，坏一块后业务仍通，是否可以不处理？**

答案：不应长期忽略。平台可能进入降级容量，剩余模块失去冗余，跨线卡流量在高峰时可能拥塞；应核对当前 Fabric 容量和更换窗口。

**问题：端口总带宽等于厂商标注交换容量，是否证明完全无阻塞？**

答案：不能。还要确认数值是否按全双工计算、Fabric 配置、Port Group、PPS、Recirculation 和 Buffer 限制。

## 16. 参考资料

- [Open Compute Project：Networking](https://www.opencompute.org/projects/networking/)
- [SONiC：Architecture](https://github.com/sonic-net/SONiC/wiki/Architecture)
