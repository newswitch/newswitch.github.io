---
title: "I²C、SMBus、PMBus、SPI、eSPI、LPC、UART、GPIO 与 JTAG"
sidebar_label: "04. 主板低速与管理总线"
sidebar_position: 4
description: "解释服务器主板低速管理、固件、调试与传感器链路，建立 BMC、CPLD、VRM、FRU、SPD 和 Flash 之间的通信地图。"
tags: [I2C, SMBus, PMBus, SPI, eSPI, LPC, UART, GPIO, JTAG, MCTP]
---

# I²C、SMBus、PMBus、SPI、eSPI、LPC、UART、GPIO 与 JTAG

PCIe、DDR 和 Ethernet 负责高速数据，服务器主板仍需要大量低速链路完成上电、传感器读取、资产识别、Firmware 启动和故障调试。低速总线故障不会总是让整机宕机，却可能造成温度丢失、风扇全速、FRU 读取失败或设备无法复位。

## 1. 五类链路

```text
高速数据：PCIe / DDR / Ethernet
平台管理：I²C / SMBus / PMBus / I3C / MCTP
固件存储：SPI
主机-BMC：eSPI / LPC / KCS / PCIe VDM
调试控制：UART / GPIO / JTAG
```

协议可能复用同一物理总线。例如 PMBus 基于 SMBus/I²C 电气基础，MCTP 可以承载于 SMBus/I²C、PCIe VDM 等绑定之上。

## 2. I²C

I²C 常用两根信号线：

- SDA：双向数据；
- SCL：时钟。

它采用地址访问和开漏/上拉结构，多个设备可共享一条总线：

```text
BMC I²C Controller
├── Temperature Sensor
├── EEPROM / FRU
├── Fan Controller
└── I²C Mux → 更多分支
```

关键限制：

- 总线电容和线长影响信号；
- 地址可能冲突；
- 某设备把 SDA/SCL 拉低会卡住整条总线；
- Mux Channel 错误会让设备“消失”；
- BMC 与 Host 同时访问需要仲裁。

## 3. SMBus

SMBus 建立在与 I²C 相近的电气和事务基础上，但对超时、时钟范围、命令和设备行为有更明确约束。服务器常见用途：

- 读取 DIMM SPD；
- 获取 PCIe 卡 FRU；
- 管理 OCP NIC Sideband；
- 读取电池、温度和平台 EEPROM；
- BMC 与设备控制器通信。

“支持 I²C”不代表自动满足所有 SMBus 行为，反之也不能假设任意 I²C 工具都可安全扫描 SMBus。

## 4. PMBus

PMBus 面向数字电源管理，常用于 PSU、VRM、Hot-swap Controller：

```text
BMC / Power Controller
→ PMBus
→ PSU / VRM
   ├── Voltage
   ├── Current
   ├── Power
   ├── Temperature
   ├── Fault Status
   └── Limit / Configuration
```

PMBus 遥测值要结合比例、单位和厂商实现解释。错误写寄存器可能改变电压或保护策略，生产环境不能随意试写。

## 5. I3C

I3C 继承两线共享总线思路，提供更高速率、动态地址和 In-band Interrupt 等能力，可用于新一代平台管理和设备遥测。部署时仍需确认：

- Controller 和设备是否支持相同模式；
- 是否与 Legacy I²C 设备共存；
- BMC/Firmware 是否完成枚举；
- 工具是否理解动态地址。

## 6. SPI

SPI 常使用 Clock、数据输入/输出和独立 Chip Select，适合连接 Firmware Flash：

```text
CPU/PCH/BMC
→ SPI Controller
→ BIOS/UEFI Flash、BMC Flash、CPLD 配置存储
```

特点：

- 通常无统一设备发现；
- Chip Select 决定目标；
- 读写时序和 Flash Layout 很关键；
- 升级中断可能破坏可启动镜像；
- Dual Image/Recovery 设计决定可恢复性。

## 7. LPC 与 eSPI

LPC 是传统低引脚数平台总线，用于连接 Super I/O、TPM、BMC/KCS 等低速设备。eSPI 是后续演进方向，可承载 Peripheral、Virtual Wire、Out-of-band 和 Flash 等 Channel。

```text
Host PCH/SoC
↔ eSPI/LPC
↔ BMC / Super I/O / TPM / Debug Logic
```

Host 无法通过 KCS 访问 BMC 时，可能是 eSPI/LPC、BMC Firmware 或驱动问题，而不是管理网口故障。

## 8. UART

UART 是异步串行通信，常用于：

- BIOS/BMC/Bootloader Debug Console；
- Serial over LAN 的底层来源；
- CPLD/设备维护；
- 生产测试。

波特率、数据位、校验位和停止位必须匹配。UART 通常是点对点，电平标准也可能是 TTL、RS-232 或其他形式，不能直接混接。

## 9. GPIO

GPIO 是最基础的数字输入/输出，用于离散状态和控制：

- Presence；
- Power Good；
- Reset；
- Interrupt；
- Fault/LED；
- Strap 配置；
- Leak Detect。

GPIO 只表示电平，真正含义由主板原理图和 Firmware 定义。一个 `0` 可能表示正常，也可能因 Active-low 表示故障。

## 10. JTAG

JTAG 常用于芯片边界扫描、烧录和硬件调试。它可以访问比操作系统更底层的状态，因此：

- 生产设备应限制物理和逻辑访问；
- 调试接口可能影响安全启动和 Root of Trust；
- 错误操作可能暂停芯片或修改配置；
- 通常只由硬件/厂商工程流程使用。

## 11. MCTP

Management Component Transport Protocol 为平台组件提供统一消息传输，可承载在：

- SMBus/I²C；
- PCIe VDM；
- 其他标准 Binding。

上层可运行 PLDM、SPDM 等管理和安全协议。要区分：

```text
物理/链路：SMBus、PCIe VDM
→ 传输：MCTP
→ 管理模型：PLDM
→ 安全会话/认证：SPDM
```

## 12. 一次温度读取

```text
BMC 用户空间服务
→ I²C/SMBus Controller Driver
→ Mux Channel
→ Temperature Sensor Register
→ BMC Sensor Repository
→ IPMI SDR / Redfish Thermal Resource
→ 监控系统
```

Redfish 温度缺失可能来自传感器、Mux、内核驱动、BMC 服务或 Redfish 映射任意一层。

## 13. 常见故障

| 现象 | 可能原因 |
| --- | --- |
| 一组传感器同时消失 | I²C Mux、上游 Bus、供电 |
| 风扇突然全速 | 温度传感器失联后的安全策略 |
| SPD 读取失败 | DIMM、SMBus、Mux、BIOS/BMC 冲突 |
| PSU 遥测全为零 | PMBus、PSU 管理电源或映射异常 |
| BIOS 无法升级 | SPI Flash、写保护、镜像布局 |
| Host 看不到 BMC KCS | eSPI/LPC、驱动、BMC 服务 |
| SOL 无输出 | UART Route、波特率、BIOS Console 设置 |

## 14. Linux 观察与风险

```bash
i2cdetect -l
i2cget -y BUS ADDRESS REGISTER
ls -l /sys/bus/i2c/devices/
ipmitool sdr elist
ipmitool mc info
journalctl -k | grep -Ei 'i2c|smbus|spi|espi|lpc'
```

注意：对未知总线运行 `i2cdetect`、`i2cget` 或写操作可能干扰 SPD、VRM 和平台控制器。生产环境应先查主板文档和驱动占用情况，优先使用 BMC/厂商只读接口。

## 15. 排障方法

1. 判断是单设备、一个 Mux 分支还是整条 Bus；
2. 检查目标器件 Standby Power 和 Reset；
3. 对照主板 Block Diagram 确定 Controller 与 Mux；
4. 比较 Host、BMC 和 Redfish/IPMI 的不同视角；
5. 检查 Bus Stuck、Timeout、NACK 和 Arbitration；
6. 仅在维护窗口执行 Bus Recovery、BMC Reset 或 Firmware 更新。

## 16. 练习与答案

**问题：BMC 网络可以访问，但所有温度传感器消失，说明 BMC 正常吗？**

答案：只能证明 BMC 的部分网络和服务仍工作。传感器所在 I²C/SMBus、Mux、驱动或管理服务可能故障，应沿读取链路继续定位。

**问题：SPI 和 I²C 都是低速总线，为什么 BIOS Flash 常用 SPI？**

答案：SPI 具有适合连续读写 Firmware 的简单同步数据路径和独立 Chip Select；I²C 更适合共享总线上的低速传感器和配置设备。两者协议和用途不同。

## 17. 参考资料

- [DMTF：MCTP Standards](https://www.dmtf.org/standards/pmci)
- [Linux Kernel：I2C and SMBus Subsystem](https://docs.kernel.org/i2c/index.html)
- [PMBus：Specifications](https://pmbus.org/specification-archives/)
