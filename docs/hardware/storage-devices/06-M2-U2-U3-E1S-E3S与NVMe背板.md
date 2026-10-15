---
title: "M.2、U.2、U.3、E1.S、E3.S 与 NVMe 背板"
sidebar_label: "06. NVMe 外形、槽位与背板"
sidebar_position: 6
description: "区分 NVMe 协议、PCIe 链路、M.2/U.2/U.3/EDSFF 外形，并解释企业服务器 NVMe 背板、热插拔、PCIe Switch、Retimer 与槽位映射。"
tags: [NVMe, M.2, U.2, U.3, EDSFF, E1.S, E3.S, 背板]
---

# M.2、U.2、U.3、E1.S、E3.S 与 NVMe 背板

NVMe 是命令协议，PCIe 是传输链路，M.2、U.2、U.3 和 EDSFF 是外形、连接器或接口规范家族。把这几个维度混在一起，就会出现“外观能插入但设备无法识别”“盘支持 PCIe 5.0，槽位却只协商到 x2”等问题。

## 1. 先分清四个维度

```text
数据介质：TLC / QLC NAND
命令协议：NVMe
传输链路：PCIe Gen4 x4
外形与连接：M.2 22110 / U.2 / E1.S
```

一块盘可能是“E3.S 外形、PCIe 5.0 x4、NVMe 协议、TLC NAND”，每个词回答的问题都不同。

| 维度 | 回答的问题 | 示例 |
| --- | --- | --- |
| 介质 | 数据最终存在哪里 | TLC NAND |
| 协议 | 主机怎样提交命令 | NVMe |
| 总线 | 命令和数据怎样传输 | PCIe Gen5 x4 |
| 外形 | 设备尺寸、连接器和散热结构 | E3.S 1T |
| 平台能力 | 是否支持热插拔、管理和故障灯 | PCIe Hot-plug、Sideband |

## 2. M.2

M.2 是板卡外形和连接器规范家族，不等于 NVMe。常见设备包括：

- M.2 SATA SSD：走 SATA/AHCI；
- M.2 PCIe SSD：通常走 PCIe/NVMe；
- Wi-Fi、蜂窝网卡等非存储设备。

`2280` 表示约 22 mm 宽、80 mm 长，`22110` 表示约 22 mm 宽、110 mm 长。Key 类型、主板布线、设备协议和 Firmware 必须同时兼容。

M.2 适合主板内部启动盘、客户端和部分服务器存储，但需要注意：

- 内置位置更换通常需要停机开盖；
- 板卡面积和散热条件限制持续功耗；
- 主板插槽可能与 SATA Port 或 PCIe Slot 共享 Lane；
- 物理插入不表示协议一定兼容；
- 是否支持热插拔取决于完整平台，而不是 NVMe 协议名称。

## 3. U.2

U.2 常用于 2.5 英寸企业 NVMe SSD，连接体系源自 SFF-8639。它能够把 PCIe Lane、时钟、电源和管理信号引到前置盘位，便于高密度部署、散热和维护。

典型路径：

```text
CPU PCIe Root Port
→ Cable / Retimer / Backplane
→ U.2 Drive Bay
→ PCIe x4 NVMe SSD
```

U.2 的企业价值不只在于性能，还在于前置维护、状态灯、Presence 检测、热插拔设计和稳定供电。是否真正具备这些能力要看服务器整体认证。

## 4. U.3

U.3 常指基于 SFF-TA-1001 的通用 x4 Link 定义，目标是在相应连接体系中承载 PCIe/NVMe、SAS 或 SATA 等设备类型。它不是一种新的存储协议。

```text
U.3 盘位可用
≠ 任意 U.2/U.3/SAS/SATA 盘都能直接混插
```

能否使用取决于：

- Backplane 是否支持相应信号和 Pin 定义；
- 上游是 Tri-mode Controller 还是 CPU PCIe Root Port；
- Cable 与 Lane Mapping 是否正确；
- BIOS、BMC、Controller Firmware 是否支持；
- 盘和整机是否出现在兼容矩阵中。

所以排查 U.3 盘不识别时，不能只看连接器外观。

## 5. PCIe Add-in Card

Add-in Card（AIC）直接插入 PCIe Slot，可提供更大的 PCB、散热器和功耗空间，也可能在单卡上集成多个 SSD Controller。它的局限是占用扩展槽、前置维护不便，并受到 Slot NUMA 归属、Lane 宽度和机箱风道约束。

## 6. EDSFF

EDSFF 面向数据中心 SSD 的密度、散热、功耗、信号完整性和可维护性。常见家族如下：

| 外形 | 一般定位 | 主要关注点 |
| --- | --- | --- |
| E1.S | 适合 1U 高密度前置盘位 | 厚度、散热器、单盘功耗 |
| E1.L | 长条形、高容量密度 | 机箱空间、气流和维护 |
| E3.S | 较宽、适合更高功耗或更多能力 | 1T/2T 厚度、Lane 和散热 |
| E3.L | 更长、支持更大的板卡空间 | 容量、功耗、平台布局 |

EDSFF 是持续演进的规范家族。设计或采购时要看具体 SFF 规范版本、厚度、连接器、Lane 数、电源和整机支持，不能只写“支持 E3”。

## 7. NVMe 背板内部有什么

背板不一定只是铜线。常见实现包括：

### 7.1 Direct Attach

```text
CPU Root Port 0 ── PCIe x4 ── Slot 0
CPU Root Port 1 ── PCIe x4 ── Slot 1
```

路径直接、故障域清晰，但会消耗较多 CPU PCIe Lane 和 Cable。

### 7.2 PCIe Bifurcation

一个 x16 Root Port 可由平台拆分为 `x4+x4+x4+x4`，分别连接四块 NVMe SSD。它需要 CPU、BIOS、Riser 和布线共同支持。

### 7.3 PCIe Switch

```text
CPU PCIe x16
→ PCIe Switch
   ├── NVMe 0 x4
   ├── NVMe 1 x4
   ├── NVMe 2 x4
   └── NVMe 3 x4
```

Switch 可以扩展端口数量和支持设备间转发，但多盘共享上行，聚合带宽可能超卖；Switch 也是共同故障点。

### 7.4 Retimer

高速 PCIe 信号经过长走线、Cable、Connector 和 Backplane 后会衰减。Retimer 重新恢复时钟和数据，提高链路裕量，但也增加 Firmware、温度和链路训练排障对象。

## 8. 管理链路和 Sideband

企业盘位还需要处理数据链路之外的能力：

- Presence：检测盘是否插入；
- Attention/Locate/Fault LED：定位和告警；
- PCIe Hot-plug：安全上下电和重新枚举；
- SMBus/I2C、VPD：资产和状态信息；
- UBM：统一背板管理相关能力；
- Slot Power Control：控制浪涌和故障隔离。

NVMe 数据可以正常传输，不代表故障灯、热插拔和槽位编号一定正确。

## 9. Lane、带宽和 NUMA

以一块 PCIe x4 SSD 为例，它的有效性能上限同时受以下因素影响：

```text
设备支持的 PCIe 代际和宽度
∩ 槽位实际布线
∩ 上游 Switch/Root Port 能力
∩ 链路训练结果
∩ CPU Socket / NUMA 归属
∩ 多设备共享上行负载
```

跨 Socket 访问不会让数据必然经过 CPU Core 搬运，但 I/O Completion、DMA 目标内存和消费线程可能跨 Socket Interconnect，增加延迟并占用互联带宽。

## 10. 从设备名映射到物理槽位

设备节点和 Controller 编号可能在重启后变化，应联合使用 PCIe 地址、序列号和槽位信息：

```bash
nvme list
nvme list-subsys
lspci -Dtv
lspci -vv -s 0000:81:00.0
udevadm info --query=property --name=/dev/nvme0n1
cat /sys/class/nvme/nvme0/address
cat /sys/class/nvme/nvme0/serial
```

再与 BMC、机箱槽位表或厂商管理工具对照，建立：

```text
/dev/nvme0n1
↔ NVMe Serial
↔ PCIe BDF
↔ Root Port / Switch Port
↔ NUMA Node
↔ Front Bay 编号
```

## 11. 热插拔的安全边界

“NVMe 支持热插拔”不能替代操作步骤。更换前至少确认：

1. 数据已迁移，阵列/副本允许摘盘；
2. 通过序列号和 Locate LED 锁定槽位；
3. 文件系统、LVM、RAID 或存储服务已停止使用该设备；
4. 平台支持对应槽位的 PCIe Hot-plug；
5. 按厂商流程执行 Remove/Power-off；
6. 更换后检查 Link Width/Speed、健康日志和重建状态。

直接拔出仍有 DMA 或写请求的设备，可能触发 I/O Error、PCIe AER、文件系统损坏或整条上游链路异常。

## 12. 选型对照

| 需求 | 常见方向 | 必须确认 |
| --- | --- | --- |
| 主板启动盘 | M.2 | RAID/镜像、散热、维护方式 |
| 前置企业 NVMe | U.2/U.3 | 背板、热插拔、Controller 矩阵 |
| 1U 高密度 | E1.S | 厚度、功耗、气流和槽位数 |
| 更高功耗/更多 Lane | E3.S/E3.L | 具体规格、Lane 和平台认证 |
| 大散热空间 | AIC | Slot、NUMA、风道和可维护性 |

## 13. 练习与答案

**问题：M.2 SSD 是否一定使用 NVMe？**

答案：不一定。M.2 描述外形和连接体系，设备可能走 SATA/AHCI，也可能走 PCIe/NVMe，必须结合 Key、主板布线和型号判断。

**问题：四块 PCIe 5.0 x4 SSD 接在一颗上行只有 PCIe 5.0 x8 的 Switch 后面，能否同时获得各自满带宽？**

答案：不能保证。下行总带宽超过上行，所有设备并发时会竞争共享上行；单盘测试正常不能证明聚合负载没有超卖。

**问题：U.3 盘插入外观相同的盘位后不识别，第一步是否应该判定盘损坏？**

答案：不应该。先核对背板协议、上游 Controller、Cable/Lane Mapping、Firmware 和兼容矩阵，再做换盘换槽交叉验证。

## 14. 参考资料

- [SNIA：SSD Form Factors](https://www.snia.org/node/14267)
- [SNIA：SFF Specifications](https://www.snia.org/technology-communities/sff/specifications)
- [SNIA：Answering Your Questions About EDSFF](https://www.snia.org/blog/2020/answering-your-questions-edsff)
