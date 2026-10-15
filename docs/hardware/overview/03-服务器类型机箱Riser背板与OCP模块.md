---
title: "服务器类型、机箱、Riser、背板与 OCP 模块"
sidebar_label: "03. 服务器形态与机箱组件"
sidebar_position: 3
description: "从塔式、机架式、刀片式、多节点和 GPU 服务器出发，解释机箱、Riser、背板、Midplane、OCP NIC 与 DC-SCM 的结构和选型边界。"
tags: [服务器, 机箱, Riser, 背板, OCP NIC, DC-SCM]
---

# 服务器类型、机箱、Riser、背板与 OCP 模块

服务器不是“主板加一个机箱”。相同 CPU、内存和 GPU 放进不同形态后，PCIe 扩展、供电、散热、硬盘维护和共同故障域都会改变。理解整机机械结构，才能把系统里的 PCIe 地址、BMC 槽位、前置盘位和真实硬件对应起来。

## 1. 常见服务器形态

| 形态 | 典型特点 | 适合场景 | 主要限制 |
| --- | --- | --- | --- |
| 塔式 | 类似大型工作站，空间宽松 | 小型环境、边缘站点 | 密度和集中运维较弱 |
| 机架式 | 19 英寸机架，常见 1U/2U/4U | 通用数据中心 | 受 U 高度、风道和功率限制 |
| 刀片式 | 多个计算刀片共享机框资源 | 高密度、统一管理 | 机框是共享故障域，生态绑定较强 |
| 多节点服务器 | 一个机箱容纳多个相对独立节点 | 云计算、HPC、横向扩展 | PSU、风扇或背板可能共享 |
| GPU/加速服务器 | 高功率 GPU/NPU、NVSwitch 和高速 NIC | AI 训练与推理 | 重量、功耗、散热和布线复杂 |
| 存储服务器 | 大量前置/后置盘位和 HBA | Ceph、对象存储、归档 | 背板上行和重建故障域 |
| Composable/Disaggregated | 通过 Fabric 动态组合资源 | 资源池化、专用平台 | 管理栈和互操作复杂 |

“2U 服务器”只说明高度约占两个 Rack Unit，不说明 CPU 数、GPU 数、盘位数或 PCIe 拓扑。

## 2. RU、OU 与机架宽度

- RU/U：传统 19 英寸机架的高度单位，`1U = 1.75 英寸`；
- OU：OCP Open Rack 使用的开放机架高度单位和机械体系；
- 机架宽度：19 英寸通常指安装立柱标准，不等于机柜外宽；
- 深度和承重：GPU 服务器可能很深、很重，必须核对滑轨、地板和机柜承载。

不能仅凭“都是 1U”判断两台设备的滑轨、供电连接器或机架兼容。

## 3. 机箱内部组件地图

```text
前部
├── Drive Cage / NVMe Backplane
├── 前置 NIC 或 I/O Module（部分平台）
├── 高压差风扇墙
├── CPU / DIMM / GPU / Accelerator
├── Riser / PCIe Cable / Switch Board
├── PSU / Power Distribution Board
└── BMC 管理口、OCP NIC、后置 I/O
后部
```

典型可维护部件包括：

- System Board/HPM：CPU、DIMM、Root Port 和平台控制核心；
- Drive Backplane：连接前置 HDD/SSD，可能包含 Expander、Switch 或 Retimer；
- Midplane：连接机箱前后或多个抽屉，既可能承载高速信号，也可能承载电源和管理信号；
- Riser：改变 PCIe 卡安装方向并重新布出 Lane；
- PDB/Power Board：把 PSU 电力分配到主板和设备；
- Fan Board：风扇供电、转速和 Presence 管理；
- Front Panel Board：按钮、状态灯、USB、Debug 接口；
- BMC/DC-SCM：平台管理和安全控制。

## 4. Riser 不只是转接板

Riser 的作用是让 PCIe 卡在有限高度内横向安装。按实现可分为：

- Passive Riser：主要完成连接器和走线转换；
- Riser with Retimer：补偿高速链路损耗；
- Riser with PCIe Switch：一个上行连接多个设备；
- Cable Riser：通过高速 Cable 把 Root Port 引到远处；
- Proprietary GPU Baseboard：承载多个加速器和专用互联。

必须核对：

```text
机械 x16 槽
≠ 电气 x16
≠ 当前协商 x16
```

同一 Riser 的插槽还可能共享 CPU Lane、Switch 上行或电源预算。

## 5. Backplane 与 Midplane

### 5.1 Backplane

背板通常直接服务一组可插拔设备，例如硬盘、风扇或电源模块。它可能是：

- 纯被动走线；
- 带 SAS Expander；
- 带 PCIe Switch/Retimer；
- 支持 UBM、LED 和热插拔管理的智能背板。

### 5.2 Midplane

Midplane 位于机箱中部，用于连接前后模块、计算节点和共享资源。刀片机框中的 Midplane 可能承载：

- Ethernet/InfiniBand Fabric；
- PCIe/CXL 链路；
- 管理网络；
- 电力和时钟；
- 节点 Presence 与 FRU 信息。

Midplane 故障往往同时影响多个节点，因此必须画进故障域。

## 6. OCP NIC

OCP NIC 是面向服务器的标准化 Mezzanine NIC 形态。与普通 PCIe AIC 相比，它更强调服务器内部空间、散热、管理和可维护性。

常见关注点：

- Small Form Factor 与 Large Form Factor；
- PCIe Lane 数和代际；
- 网络 Port 数、速率和介质；
- NC-SI/SMBus 等管理 Sideband；
- FRU、MAC 地址和资产信息；
- 散热器方向与机箱风道；
- 平台是否允许不断开主机业务维护。

OCP NIC 3.0 是连接器和系统集成规范，不代表卡一定是普通 NIC；设备也可能是 HCA、SmartNIC 或 DPU。

## 7. DC-SCM 与 HPM

DC-SCM（Data Center Secure Control Module）把平台通用的管理与安全硬件放到可标准化模块中，HPM（Host Processor Module）保留主机处理器、内存和主要 I/O。

```text
DC-SCM
├── BMC
├── Root of Trust / TPM 类安全组件
├── 管理 Firmware 与存储
└── 管理/安全接口
        ↕ DC-SCI
HPM
├── CPU / DIMM
├── PCIe / CXL
├── OCP NIC / Accelerator
└── 平台电源与复位逻辑
```

这种拆分提高了平台复用和管理模块可替换性，但实际服务器是否采用、采用哪个规范版本，必须查看整机文档。

## 8. GPU 服务器为什么更复杂

GPU 服务器通常额外包含：

- PCIe GPU 或专用 SXM/Baseboard；
- NVLink/NVSwitch Fabric；
- 多块高带宽 NIC/HCA；
- PCIe Switch、Retimer 和大量 Cable；
- 更高功率 PSU、Busbar 或液冷接口；
- 独立 GPU 管理控制器和 Firmware。

同为“8 GPU 服务器”，可能是八块独立 PCIe 卡，也可能是经 NVSwitch 全互联的 Baseboard，通信能力和故障域完全不同。

## 9. 共享故障域

| 共享部件 | 可能同时受影响的对象 |
| --- | --- |
| PSU/PDB | 整机或一组节点 |
| Fan Board/风扇墙 | 同一风道内全部高功率部件 |
| SAS Expander | 一组磁盘 |
| PCIe Switch | 多块 GPU/NVMe/NIC |
| Midplane | 多个刀片或计算节点 |
| BMC/DC-SCM | 带外管理、传感器和电源控制 |
| NVSwitch | 一组 GPU P2P 通信 |

高可用设计不能只数设备数量，还要确认它们是否共享同一上游组件。

## 10. 从操作系统映射回机箱

```bash
sudo dmidecode -t system -t chassis -t slot
sudo lspci -Dtv
sudo lspci -vv
sudo ipmitool fru
sudo ipmitool sdr elist
sudo nvme list
sudo lsscsi -g
```

资产系统应维护：

```text
设备节点 / PCIe BDF
↔ 序列号与 FRU
↔ Riser/Backplane Port
↔ 机箱槽位
↔ CPU Socket / NUMA Node
↔ 上游 Switch/Controller
```

## 11. 选型方法

1. 从工作负载确定 CPU、内存、GPU、NIC 和存储数量；
2. 计算 PCIe Lane、上行共享和 NUMA 归属；
3. 计算持续功率、峰值功率和散热方式；
4. 确认前后维护、热插拔和线缆空间；
5. 画出 PSU、风扇、背板、Switch 和 Midplane 故障域；
6. 检查机柜深度、承重、PDU 和冷却能力；
7. 用完整配置做 Burn-in，而不是只测试空机箱。

## 12. 练习与答案

**问题：两台 2U 服务器都提供八个前置 NVMe 盘位，性能是否一定相同？**

答案：不一定。一台可能每盘直连 CPU x4，另一台可能通过共享 PCIe Switch x16 上行；还要比较 PCIe 代际、NUMA、Retimer、散热和固件。

**问题：Riser 上有三个 x16 长度插槽，是否一定需要 48 条 CPU PCIe Lane？**

答案：不一定。插槽可能只布 x8/x4，也可能经 PCIe Switch 或共享 Bifurcation，必须读取主板 Block Diagram 和 Link Status。

## 13. 参考资料

- [Open Compute Project：OCP NIC 3.0](https://www.opencompute.org/projects/server/mezz-nic/)
- [Open Compute Project：DC-SCM](https://www.opencompute.org/projects/server/data-center-secure-container-module/)
- [Open Compute Project：Rack & Power](https://www.opencompute.org/projects/rack-and-power/)
