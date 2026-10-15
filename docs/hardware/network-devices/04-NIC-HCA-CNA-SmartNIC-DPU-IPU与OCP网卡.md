---
title: "NIC、HCA、CNA、SmartNIC、DPU、IPU 与 OCP 网卡"
sidebar_label: "04. 网卡类型、卸载与选型"
sidebar_position: 4
description: "区分 Ethernet NIC、InfiniBand HCA、CNA、RDMA NIC、SmartNIC、DPU 和 IPU，解释 OCP/AIC 外形、卸载边界与 AI 集群选型。"
tags: [NIC, HCA, CNA, SmartNIC, DPU, IPU, OCP NIC, RDMA]
---

# NIC、HCA、CNA、SmartNIC、DPU、IPU 与 OCP 网卡

“网卡”可以只是收发 Ethernet Frame 的 NIC，也可以是支持 InfiniBand/RDMA 的 HCA，甚至包含多核 CPU、独立内存、存储和安全引擎的 DPU。厂商命名没有完全统一，选型必须比较实际数据路径和可编程能力。

## 1. 普通 Ethernet NIC

基础 NIC 负责：

- MAC/PHY/SerDes；
- TX/RX Queue 与 DMA；
- Checksum、TSO/GSO、RSS 等 Offload；
- VLAN、Tunnel、Flow Steering；
- MSI-X 中断和时间戳；
- SR-IOV PF/VF（取决于型号）。

```text
Application
→ Kernel TCP/IP
→ NIC Driver
→ NIC Queue / DMA
→ MAC / PHY
→ Ethernet Link
```

普通 NIC 也可能具有复杂 ASIC，不能仅凭“支持 Offload”称为 DPU。

## 2. HCA

Host Channel Adapter 常用于 InfiniBand，也可指提供 RDMA 能力的主机适配器。它通常支持：

- Queue Pair、Completion Queue；
- Memory Registration 与 Protection Key；
- RDMA Read/Write/Send；
- Kernel Bypass；
- InfiniBand 或 RoCE（具体看端口模式和型号）；
- GPUDirect RDMA（依赖完整平台）。

HCA 不是普通 NIC 加一个更快端口，其 Transport、Subnet、内存语义和工具链可能不同。

## 3. CNA

Converged Network Adapter 试图在同一物理网络承载多类流量，例如普通 Ethernet 与存储流量。典型能力可能包括：

- FCoE；
- iSCSI Offload；
- DCB/PFC/ETS；
- 多队列和虚拟接口。

CNA 是融合 I/O 的产品定位，不代表它一定具有通用可编程处理器。

## 4. RDMA NIC

支持 RoCE 或 iWARP 的 Ethernet NIC 可提供 RDMA。选型要区分：

- InfiniBand HCA；
- RoCEv2 Ethernet NIC/HCA；
- iWARP NIC；
- 是否支持需要的传输和拥塞控制；
- 是否支持 GPU Direct、PeerDirect、SR-IOV 和时间戳。

“支持 RDMA”不表示网络可以直接无损运行，还需要交换机 Buffer、ECN/PFC、路由和端到端参数配合。

## 5. SmartNIC

SmartNIC 一般比固定功能 NIC 提供更强的可编程数据面，常见实现包括：

- 可编程 ASIC；
- FPGA；
- NIC ASIC 加嵌入式 Core；
- SoC/DPU 形态。

可能卸载：

- vSwitch、Overlay 和 ACL；
- Firewall、NAT、IPsec/TLS；
- Storage Virtualization、NVMe-oF；
- Telemetry 和 Traffic Shaping；
- Service Function Chain。

“SmartNIC”没有单一硬件门槛，必须列出它能独立运行什么，以及 Host CPU 是否仍管理 Control Plane。

## 6. DPU

DPU（Data Processing Unit）通常在 NIC 数据面之外集成：

- 多核通用处理器；
- 独立 DRAM；
- 高速网络端口；
- PCIe Root/Endpoint/Switch 能力；
- 加密、正则、压缩和存储引擎；
- 独立 OS 与管理通道。

```text
外部网络
↔ DPU Port
↔ DPU Data Plane / Embedded CPU / Accelerator
↔ PCIe
↔ Host CPU、GPU、NVMe
```

DPU 可以把租户数据面与基础设施控制面隔离，但会新增一个需要升级、监控、加固和恢复的计算系统。

## 7. IPU

IPU（Infrastructure Processing Unit）强调把网络、存储、安全和虚拟化等基础设施功能从 Host CPU 卸载，并由基础设施拥有者控制。

行业中的 DPU/IPU 命名存在重叠。判断产品时不要只看名称，应检查：

- 是否具有独立 CPU 和内存；
- Host 与卡谁是 PCIe Root/Endpoint；
- Control Plane 由谁控制；
- 是否可以在 Host 不可信时强制隔离；
- 能否卸载网络、存储和安全完整路径；
- 故障时数据是否旁路或中断。

## 8. AIC、Mezzanine 与 OCP NIC

| 外形 | 特征 |
| --- | --- |
| PCIe AIC | 通用扩展槽，兼容面广，占用 Riser/Slot |
| 厂商 Mezzanine | 空间紧凑，但可能平台专有 |
| OCP NIC 2.0 | 较早开放 Mezzanine 形态 |
| OCP NIC 3.0 | 面向现代服务器的机械、电气和管理规范 |

OCP NIC 3.0 还需区分 SFF/LFF、PCIe Lane、散热、连接器和平台 Firmware 支持。外形兼容不等于网络速率、协议和管理功能兼容。

## 9. Port、Lane 与 Breakout

网卡面板上的一个 OSFP/QSFP Port 可能包含多条高速 Lane：

```text
1 × 400G Port
→ 4 × 100G Lane（示意）
→ 可按模块、Cable、NIC Firmware 和交换机能力 Breakout
```

实际 Lane 编码与速率取决于 Ethernet 代际。Breakout 后：

- 物理 Port 与逻辑 Port 数变化；
- FEC 和 Auto-negotiation 配置需匹配；
- 总带宽不会凭空增加；
- Firmware、Cable 和对端必须支持相同模式。

## 10. PF、VF 与 SF

- PF：PCIe Physical Function，拥有完整配置能力；
- VF：SR-IOV Virtual Function，提供给 VM/容器的轻量 Function；
- SF：部分设备提供的 Subfunction，比 VF 具有不同管理模型。

```text
一个物理 Port
→ 一个或多个 PF
→ 多个 VF/SF
→ VM、容器或服务
```

虚拟 Function 增加隔离和并发，但 Queue、Flow Table、MSI-X、Bandwidth 仍是有限硬件资源。

## 11. 三个平面

| 平面 | 职责 | 故障表现 |
| --- | --- | --- |
| Data Plane | 收发、转发、RDMA、Offload | 丢包、延迟、吞吐下降 |
| Control Plane | 路由、Flow、VF、策略 | 规则不生效、接口创建失败 |
| Management Plane | Firmware、BMC/Redfish、健康 | 无法升级、遥测缺失 |

DPU 的管理口正常不代表 Host-DPU PCIe 和外部网络数据路径正常。

## 12. AI 集群中的选择

### 12.1 训练 Fabric

关注：

- InfiniBand 或 RoCE；
- 端口带宽和 Rail 数；
- RDMA、GPUDirect、拥塞控制；
- PCIe/NVLink/GPU NUMA 亲和性；
- Collective 通信和尾延迟。

### 12.2 存储网络

关注：

- RDMA/NVMe-oF/Ceph 协议；
- 多队列、Checksum、Encryption；
- 与训练 Fabric 是否隔离；
- DPU Storage Offload 的恢复语义。

### 12.3 管理和业务网络

管理网更关注稳定和带外可达；推理业务网关注 PPS、连接数、TLS 和负载均衡。不能因训练网络带宽高就把所有流量无规划地汇聚。

## 13. 选型清单

```text
Ethernet / InfiniBand / 双模式
Port 数、速率、Lane 与 Breakout
PCIe 代际和宽度
NUMA 与 GPU 亲和性
RDMA、GPUDirect、SR-IOV、时间戳
Queue、Flow Table、VF 和 MSI-X 规模
光模块/DAC/AOC 与 FEC
Firmware、驱动和交换机兼容
功耗、散热和 OCP/AIC 外形
安全启动、DPU OS 与生命周期管理
```

## 14. 观测命令

```bash
lspci -nnk | grep -A3 -Ei 'ethernet|network|infiniband'
ethtool -i eth0
ethtool eth0
ethtool -k eth0
ethtool -S eth0
devlink dev show
devlink port show
rdma link show
ibv_devinfo
ibstat
```

还要记录 Firmware、PCIe Link Speed/Width、NUMA Node、Port 模式和交换机对端。

## 15. 练习与答案

**问题：支持 SR-IOV 的 NIC 是否就是 SmartNIC？**

答案：不是。SR-IOV 是 PCIe Function 虚拟化能力，许多普通 NIC 都支持；SmartNIC 通常还强调更丰富的可编程数据面和基础设施卸载。

**问题：把 vSwitch 卸载到 DPU 后，Host CPU 是否完全不再参与网络？**

答案：不一定。连接建立、策略下发、异常路径、未命中流量和管理控制仍可能涉及 Host 或 DPU CPU，取决于具体 Offload 架构。

## 16. 参考资料

- [Open Compute Project：OCP NIC 3.0](https://www.opencompute.org/projects/server/mezz-nic/)
- [Intel：Infrastructure Processing Unit](https://www.intel.com/content/www/us/en/products/details/network-io/ipu.html)
- [NVIDIA：What Is a DPU](https://blogs.nvidia.com/blog/whats-a-dpu-data-processing-unit/)
