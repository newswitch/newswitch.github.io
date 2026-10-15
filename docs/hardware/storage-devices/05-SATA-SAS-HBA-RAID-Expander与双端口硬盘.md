---
title: "SATA、SAS、HBA、RAID、Expander 与双端口硬盘"
sidebar_label: "05. SATA、SAS、HBA 与双端口"
sidebar_position: 5
description: "从 SATA/AHCI 与 SAS/SCSI 出发，解释 HBA、RAID Controller、SAS Expander、双端口、Multipath、背板和 Tri-mode 拓扑。"
tags: [SATA, SAS, HBA, RAID, Expander, Multipath]
---

# SATA、SAS、HBA、RAID、Expander 与双端口硬盘

SATA 和 SAS 都能连接 HDD/SSD，但它们的队列、拓扑、双端口、错误恢复和高可用边界不同。企业磁盘柜中的路径往往不是“主板一根线直接连一块盘”，而是经过 HBA、Expander、背板和多路径。

## 1. SATA 路径

典型服务器 SATA 路径：

```text
CPU
→ PCH 或 PCIe SATA Controller
→ AHCI / SATA Port
→ Cable / Backplane
→ SATA HDD/SSD
```

SATA 通常是点对点单端口设备，使用 ATA 命令。NCQ 允许多个命令在途，但队列和拓扑能力与 SAS/NVMe 不同。

## 2. SAS 路径

```text
CPU PCIe Root
→ SAS HBA / RAID Controller
→ 一个或多个 SAS Phy / Wide Port
→ SAS Expander（可选）
→ Backplane
→ SAS HDD/SSD
```

SAS 使用 SCSI 命令体系，支持企业错误管理、深队列、双端口和可扩展拓扑。

## 3. SAS 的三类协议

| 协议 | 用途 |
| --- | --- |
| SSP | 在 SAS 上承载 SCSI 命令，访问 SAS Target |
| STP | 让 SAS Initiator 访问 SATA 设备 |
| SMP | 发现和管理 SAS Expander 拓扑 |

因此 SAS Controller 通常能连接 SAS 和 SATA 设备；普通 SATA Controller 不能因此支持 SAS 盘。

## 4. Phy、Port 与 Wide Port

- Phy：一条 SAS 物理链路；
- Port：由一个或多个 Phy 组成的逻辑端口；
- Wide Port：聚合多条 Phy，增加带宽和路径能力；
- SAS Address：设备/端口的全局标识；
- Domain：由 Initiator、Expander 和 Target 构成的 SAS 拓扑。

多条 Phy 的标称带宽不能简单相加为单盘性能，流量还受 Expander、HBA PCIe 上行和设备本体约束。

## 5. HBA 与 RAID Controller

### 5.1 HBA

Host Bus Adapter 主要把 SAS/SATA 设备暴露给 OS。IT/HBA 模式通常让每块盘保持独立身份，适合软件 RAID、Ceph、ZFS 或由上层管理冗余的系统。

### 5.2 RAID Controller

RAID Controller 可在卡上完成条带、镜像、校验、缓存和错误恢复，并向 OS 暴露 Logical Drive。它可能包含 DRAM Cache、Battery/Capacitor 和 CacheVault 类保护。

```text
物理盘 × N
→ RAID Controller Firmware
→ Virtual/Logical Drive
→ OS 只看到逻辑块设备
```

硬 RAID 提供集中管理，但也增加 Firmware、Cache、Controller 和配置元数据故障域。

## 6. Write-back Cache 与掉电保护

RAID Controller 或磁盘报告写完成前，数据可能仍在易失缓存。可靠写入要求：

- Controller Cache 有电池/电容保护并健康；
- Drive Write Cache 策略与 PLP 匹配；
- Flush/FUA 正确向下传递；
- Controller 故障后缓存可由兼容硬件恢复；
- Battery/Capacitor 失效时策略安全降级。

缓存保护告警不能只通过“重启恢复”处理。

## 7. SAS Expander

Expander 类似 SAS Fabric 中的交换/路由设备，让有限 HBA Phy 连接更多 Target：

```text
HBA Wide Port
→ Expander
   ├── Disk 1
   ├── Disk 2
   ├── Disk 3
   └── 下一级 Expander（受平台限制）
```

它扩展端口数量但不创造上行带宽。大量磁盘并发重建或 Scrub 时，Expander 上行可能成为共享瓶颈。

## 8. 双端口 SAS 硬盘

企业 SAS 设备可支持两个独立 Port：

```text
Controller/HBA A → Expander A → Port A ┐
                                       ├→ Dual-port SAS Drive
Controller/HBA B → Expander B → Port B ┘
```

双端口允许多路径和控制器故障切换，但只有整条 A/B 路都独立时才有真正冗余。两个端口接到同一个 Expander/HBA，仍共享故障点。

## 9. Multipath

OS 可能通过两条路径看到同一个 LUN/设备，需要 Multipath 层：

- 使用稳定标识合并路径；
- 选择 Active/Optimized 路径；
- 检测 Path Failure；
- 按设备规则执行 Failover/Failback；
- 防止上层把同一设备当成两块独立盘。

双端口不等于可以把两个设备节点分别格式化。

## 10. 背板类型

| 背板 | 特征 |
| --- | --- |
| Passive/Direct Attach | Controller Lane 直接布到每个槽位 |
| SAS Expander Backplane | 内置 Expander，共享少量上行连接更多盘 |
| NVMe Backplane | PCIe Lane、Sideband、Hot-plug 与管理 |
| Universal/Tri-mode | 设计目标支持多协议，但依赖完整控制器、线缆和 Firmware 矩阵 |

“槽位物理能插入”不代表协议和电气链路可用。

## 11. Tri-mode Controller

Tri-mode 通常指一套 Controller/Connector/Backplane 方案能够承载 SAS、SATA 和 NVMe 设备。实现时可能需要：

- 对应的 Tri-mode HBA/RAID Controller；
- 支持协议选择的背板；
- 正确线缆和 Lane Mapping；
- UBM/Sideband 管理；
- 对应 BIOS 与 Firmware。

不能把普通 SAS HBA 接到 NVMe 盘后期望自动工作。

## 12. 故障定位

| 现象 | 优先检查 |
| --- | --- |
| 单盘消失 | 盘、槽位、连接器、Phy、供电 |
| 同组多盘同时掉线 | Expander、Wide Port、线缆、HBA |
| 路径 A 失效、B 正常 | A 侧 HBA/Expander/线缆/端口 |
| 所有盘延迟同时升高 | 上行拥塞、Controller Cache、重建 |
| OS 看到同盘两个节点 | Multipath 配置和稳定标识 |
| SATA 盘在 SAS 背板可用但 SAS 盘在 SATA 口不可用 | 正常的单向兼容边界 |

## 13. 观测与映射

```bash
lspci -nnk
lsscsi -t -g
lsblk -o NAME,HCTL,TRAN,MODEL,SERIAL,WWN
smartctl -x /dev/sdX
multipath -ll
```

还需使用 Controller 厂商工具读取 HBA/RAID Firmware、Phy、Expander、Cache 和阵列事件。`/dev/sdX` 会变化，资产映射应使用 WWN/序列号和物理槽位。

## 14. 选型边界

- 大量容量盘、双端口和共享 JBOD：SAS 拓扑更常见；
- 低成本直连设备：SATA 可满足部分场景；
- 高 IOPS/低延迟：通常选择 PCIe/NVMe；
- 软件定义存储：倾向让 OS 看到真实盘，避免未知硬 RAID 语义；
- 数据库硬 RAID：需验证 Cache/PLP、BBU、重建和故障恢复。

没有一种接口能替代数据副本和备份。

## 15. 练习与答案

**问题：双端口 SAS 盘是否能防止整块磁盘介质损坏？**

答案：不能。双端口只提供访问路径冗余，盘内 Controller、介质和 Firmware 仍可能是共同故障点，需要 RAID/副本和备份。

**问题：Expander 后面 24 块盘是否都能同时获得各自接口的满带宽？**

答案：不一定。它们共享 Expander、Wide Port 和 HBA/PCIe 上行，聚合性能受上行数量、调度和工作负载限制。

## 16. 参考资料

- [SNIA：What Is Serial Attached SCSI](https://www.snia.org/education/what-is-sas)
- [SNIA：SAS Cabling Roadmaps](https://www.snia.org/node/199)
- [SNIA：How to Connect a SAS System](https://snia.org/sites/default/files/2025-05/SNIA-SDC21-Haser-How-To-Connect-SAS-System.pdf)
- [SATA-IO：SATA Specifications](https://sata-io.org/developers/purchase-specification)
