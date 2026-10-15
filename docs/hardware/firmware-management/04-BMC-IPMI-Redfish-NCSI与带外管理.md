---
title: "BMC、IPMI、Redfish、NC-SI 与带外管理"
sidebar_label: "04. BMC 与带外管理架构"
sidebar_position: 4
description: "解释 BMC 独立硬件、管理网络、IPMI、Redfish、KCS、NC-SI、Virtual Media、SOL 和 Host Interface 的完整带外管理链路。"
tags: [BMC, IPMI, Redfish, NC-SI, KCS, SOL, 带外管理]
---

# BMC、IPMI、Redfish、NC-SI 与带外管理

BMC 是服务器里一台独立的小型管理计算机。它拥有处理器、内存、Firmware、网络和 Standby Power，即使主 CPU 未启动，也能读取部分传感器、控制电源并提供远程控制台。

## 1. BMC 硬件结构

```text
Standby Power
→ BMC SoC
   ├── CPU Core / DRAM
   ├── BMC Flash
   ├── Dedicated Management NIC
   ├── NC-SI → Host NIC Shared Port
   ├── I²C/SMBus/PMBus → Sensor/PSU/VRM/FRU
   ├── eSPI/LPC/KCS → Host
   ├── UART → BIOS Console
   ├── Video Capture / KVM
   └── GPIO → Power/Reset/LED
```

BMC 与 Host CPU 相对独立，但仍共享电源、主板线路和部分 NIC，因此不是绝对独立的故障域。

## 2. In-band 与 Out-of-band

- In-band：通过正在运行的 Host OS 和业务网络管理；
- Out-of-band：通过 BMC 独立管理路径管理；
- Host Interface：Host OS 通过内部接口访问 BMC 服务，介于两者之间。

带外管理的价值是在 OS 宕机、网络驱动未加载或主机未开机时仍可观察和控制平台。

## 3. 独立管理口与共享管理口

### 3.1 Dedicated Port

BMC 使用独立 PHY/NIC 和物理网口。隔离清晰，但占用额外布线和交换机端口。

### 3.2 Shared Port

BMC 通过 NC-SI 使用 Host NIC 的物理端口：

```text
Management Network
→ Host NIC Port
├── Host Ethernet Function
└── NC-SI Sideband → BMC
```

Host 与 BMC 可以拥有不同 MAC/IP，但共享物理链路。NIC Firmware、NC-SI Channel 或 Port 故障可能同时影响两者。

## 4. NC-SI

Network Controller Sideband Interface 定义 BMC 与网络控制器间的管理 Sideband，常用于：

- 选择 NIC Port/Channel；
- 配置 BMC 管理流量过滤；
- 查询 Link 状态；
- 通过共享网口承载管理流量；
- NIC Reset 和状态事件。

NC-SI 不等于普通 Ethernet 数据面，也不表示 BMC 可以任意访问 Host 的业务流量。

## 5. IPMI

IPMI 定义传感器、事件、电源、FRU 和管理命令模型。常见对象：

- SDR：Sensor Data Record；
- SEL：System Event Log；
- FRU：Field Replaceable Unit 信息；
- Chassis Power Control；
- Watchdog；
- SOL：Serial over LAN。

```bash
ipmitool mc info
ipmitool sdr elist
ipmitool sel elist
ipmitool fru
ipmitool chassis status
```

IPMI LAN 接口历史包袱较多，应限制网络可达、使用强认证和受支持的加密配置。

## 6. KCS 与 Host-BMC 接口

KCS 是 Host 通过内部寄存器访问 BMC/IPMI 的常见接口，通常经 LPC/eSPI 暴露：

```text
Host Process
→ /dev/ipmi0
→ Kernel IPMI Driver
→ KCS
→ BMC Firmware
```

它不经过外部管理网，所以管理口断开时 Host 仍可能读取 Sensor；反过来，Host 内核故障不会阻止远端 BMC 网络访问。

## 7. Redfish

Redfish 使用 HTTP(S)、JSON 和资源模型提供标准化管理 API：

```text
GET /redfish/v1/Systems/
GET /redfish/v1/Chassis/
GET /redfish/v1/Managers/
GET /redfish/v1/UpdateService/
```

它适合自动化读取：

- System/Chassis/Manager；
- Processor、Memory、Storage、PCIeDevice；
- Power、Thermal、Sensor；
- Account、Certificate；
- Firmware Inventory 和 Update；
- Event、Telemetry、Task。

Redfish 是数据模型和 API，不代表所有厂商实现完全没有 OEM 扩展。

## 8. IPMI 与 Redfish 的关系

| 项目 | IPMI | Redfish |
| --- | --- | --- |
| 主要接口风格 | 二进制命令 | RESTful HTTP(S) + JSON |
| 自动化可读性 | 较低 | 较高 |
| 数据模型 | Sensor/命令为主 | 资源和关系模型 |
| 传输 | KCS、RMCP+ 等 | HTTPS、Host Interface |
| 兼容现状 | 大量存量工具 | 现代平台和规模自动化 |

两者可以由同一 BMC 同时提供。Redfish 不会自动消除底层传感器、I²C 和 Firmware 故障。

## 9. SOL、KVM 与 Virtual Media

### 9.1 SOL

把 Host UART/Serial Console 通过管理网络转发，适合观察 BIOS、Bootloader 和内核早期日志。

### 9.2 Remote KVM

BMC 捕获视频并注入键盘鼠标，能够操作图形/文本控制台。

### 9.3 Virtual Media

把远端 ISO/IMG 模拟为 Host USB/CD/DVD 设备，用于安装和恢复。

Virtual Media 会进入主机启动信任边界，应限制权限、记录审计并及时卸载。

## 10. BMC 的电源控制边界

BMC 可以驱动 Power Button、Reset、PSU Enable 和 Platform Reset，但：

- `Power Cycle` 可能只重启 Host，不重启 BMC；
- `BMC Reset` 可能不影响 Host 数据面；
- AC Cycle 才会让更多 Standby 域失电；
- 某些 CPLD、Retimer 或 NIC 仍需特定 Reset Sequence。

排障时必须写清执行的是 Host Reboot、BMC Reset、DC Cycle 还是 AC Cycle。

## 11. Sensor 到 API 的路径

```text
物理 Sensor / Device Telemetry
→ I²C/PMBus/PECI/MCTP
→ BMC Kernel Driver
→ Sensor Service
→ IPMI SDR / Redfish Schema
→ 监控采集
```

读数错误可能来自传感器、Bus、驱动、单位转换、Schema 映射或采集器，不应直接判定硬件温度异常。

## 12. SEL 与事件

SEL 记录电源、温度、风扇、内存、PCIe 等平台事件，但要注意：

- BMC 时钟可能与 Host 不一致；
- SEL 容量有限，满后可能停止或覆盖；
- 事件描述可能是 OEM Code；
- Clear SEL 会破坏现场证据；
- 恢复事件不等于根因消失。

事故处理中应先导出原始 SEL、BMC 时间和当前 Sensor，再执行清理或 Reset。

## 13. 安全边界

BMC 能控制整台服务器，应视为高权限基础设施：

- 独立管理网络和 ACL；
- 禁止默认账户和弱口令；
- 使用 TLS、证书和现代 Cipher；
- RBAC 与最小权限；
- 限制 Virtual Media/KVM；
- Firmware 签名、回滚保护和漏洞治理；
- 审计 API、Console 和电源操作；
- 防止业务容器访问 BMC 网络。

## 14. BMC 正常不代表主机正常

| 现象 | 说明 |
| --- | --- |
| BMC 可 Ping，Host 不通 | Host CPU/内存/OS/业务 NIC 可能故障 |
| Host 正常，BMC 不通 | 管理 NIC、NC-SI、BMC OS 可能故障 |
| Sensor 丢失，Host 正常 | 管理 Bus/服务异常 |
| KVM 正常，Redfish 超时 | BMC 某个服务或资源耗尽 |
| IPMI 正常，Redfish 异常 | Redfish 服务/Schema/HTTPS 路径异常 |

## 15. 排障流程

```text
管理不可达
→ 检查 Dedicated/Shared Port 与交换机
→ 检查 ARP/MAC/VLAN/NC-SI Channel
→ 比较 KCS In-band 与网络 Out-of-band
→ 检查 BMC CPU/Memory/服务资源
→ 导出 SEL、Audit 和 BMC Log
→ 评估 BMC Warm Reset / Cold Reset
→ 最后才考虑 Host/AC Power Cycle
```

## 16. 练习与答案

**问题：执行 BMC Reset 会让正在运行的业务服务器重启吗？**

答案：设计上通常只重启管理控制器，Host 可继续运行；但管理能力会暂时中断，具体平台还需查看厂商边界，不能在不了解实现时批量操作。

**问题：共享管理口 Link Up，但 BMC IP 不通，Host 业务网正常，可能在哪里？**

答案：外部物理链路正常，优先检查 NC-SI Channel、BMC MAC/VLAN/IP、NIC Firmware 和 BMC 网络服务，而不是直接更换网线。

## 17. 参考资料

- [DMTF：Redfish Specification](https://www.dmtf.org/standards/redfish)
- [DMTF：NC-SI Specification](https://www.dmtf.org/standards/pmci)
- [Open Compute Project：Hardware Management](https://www.opencompute.org/projects/hardware-management/)
