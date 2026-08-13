---
title: lshw 命令详解：构建系统硬件树与可审计资产快照
sidebar_position: 12
description: 完整讲解 lshw 的全部参数、class 与 businfo、JSON/XML/HTML 输出、启停测试、权限差异、敏感字段脱敏及与 lspci/dmidecode 的边界。
tags: [Linux, lshw, 硬件资产, sysfs, PCIe]
---

# `lshw` 命令详解：构建系统硬件树与可审计资产快照

`lshw` 聚合 sysfs、DMI、PCI、CPU、内存和设备数据库，构建“系统—总线—设备—逻辑对象”的硬件树。它适合资产快照和总览，但每个字段仍要回到权威子系统工具复核。

## 1. 语法与全部参数

```text
lshw [OPTIONS...]
```

### 1.1 输出与筛选

| 参数 | 含义 |
|---|---|
| `-short` | 紧凑路径、class、description 表格 |
| `-businfo` | 显示 bus address、class、device，更适合关联 PCI/USB/SCSI |
| `-class CLASS`、`-C CLASS` | 只显示指定 class，可重复 |
| `-json` | JSON 输出 |
| `-xml` | XML 输出 |
| `-html` | HTML 输出 |
| `-dump FILE` | 在显示结果的同时写入 SQLite 格式硬件数据库文件 |
| `-X` | 若构建支持，启动图形界面 |
| `-quiet` | 不显示状态进度 |
| `-sanitize` | 隐藏部分敏感字段，如序列号/IP；不是绝对脱敏保证 |
| `-numeric` | 同时显示 PCI/USB 等数值 ID |
| `-notime` | 从输出中排除易变化时间信息 |

### 1.2 探测控制

| 参数 | 含义 |
|---|---|
| `-enable TEST` | 启用指定探测测试，可重复 |
| `-disable TEST` | 禁用指定探测测试，可重复 |

常见 TEST 包括 `dmi`、`device-tree`、`spd`、`memory`、`cpuinfo`、`cpuid`、`pci`、`isapnp`、`pcmcia`、`ide`、`usb`、`scsi`、`network`；以本机 `lshw -help` 为准。

### 1.3 帮助与版本

| 参数 | 含义 |
|---|---|
| `-version` | 显示版本 |
| `-help` | 显示帮助 |

注意 `lshw` 历史接口多为**单横线长选项**，不要凭 GNU 习惯改成双横线。

## 2. 三个最实用视图

```bash
sudo lshw -short
sudo lshw -businfo -numeric
sudo lshw -C network -numeric
```

`-businfo` 中的 `pci@0000:3b:00.0` 可以直接对应：

```bash
lspci -s 0000:3b:00.0 -nnk
udevadm info /sys/bus/pci/devices/0000:3b:00.0
```

逻辑名如 `eth0`、`/dev/nvme0n1` 可能因 udev、namespace 和启动顺序变化，不能替代序列号/WWN/BDF。

## 3. 读懂节点字段

| 字段 | 含义 |
|---|---|
| `*-class[:id]` | 硬件树节点和逻辑 ID |
| `description/product/vendor` | 描述、产品、厂商 |
| `physical id` | 父节点内的物理标识，不保证全局稳定 |
| `bus info` | PCI/USB/SCSI 等总线地址 |
| `logical name` | 接口名或设备节点，可变 |
| `serial` | 序列/地址，可能敏感或固件错误 |
| `size/capacity` | 当前大小与能力上限，语义随 class 变化 |
| `configuration` | driver、firmware、link、IP 等运行配置 |
| `capabilities` | 声明的能力集合，不等于均已启用 |

## 4. 机器输出与快照比较

```bash
sudo lshw -json -numeric -sanitize -notime > hardware.json
sudo lshw -xml -numeric -sanitize -notime > hardware.xml
```

自动化前验证本版本 JSON 结构；不同发行版/版本的字段、数组形态和探测器会变化。比较两次快照时先归一化易变字段，不要把网络地址、容量使用或逻辑名变化都当硬件更换。

`-sanitize` 只处理已知字段，输出仍可能含拓扑、产品、MAC/路径或 OEM 信息，外发前人工复核。

## 5. root 与非 root 的差异

普通用户执行时，DMI、SPD、PCI config 等信息可能不完整，lshw 会提示结果可能不全：

```bash
lshw -short
sudo lshw -short
```

不要在两种权限下直接做资产差异告警。root 探测扩大硬件访问范围；在脆弱旧设备上可用 `-disable TEST` 缩小范围。

## 6. 为什么还需要专用工具

| 问题 | 首选证据 |
|---|---|
| PCIe speed/width/AER/ACS | `lspci -vv` |
| SMBIOS 内存槽与固件 | `dmidecode` |
| NUMA CPU/内存距离 | `numactl -H`、`lstopo` |
| 块设备拓扑与文件系统 | `lsblk`、`udevadm` |
| 网卡 driver/firmware/队列 | `ethtool`、`devlink` |
| GPU/NVLink/MIG | 供应商工具与 GPU 专题命令 |

`lshw` 是索引入口，不是所有子系统状态的最终真相。

## 7. 资产采集模板

```bash
sudo lshw -businfo -numeric
sudo lshw -json -numeric -sanitize -notime
lspci -Dnnk
dmidecode -s system-product-name
uname -r
```

快照应同时记录采集时间、主机身份、工具版本与权限，否则跨主机/跨升级比较缺少语境。

## 8. 官方参考

- [lshw 官方项目](https://ezix.org/project/wiki/HardwareLiSter)
- [lshw(1)](https://manpages.debian.org/lshw/lshw.1.en.html)

下一篇：[udevadm 命令详解](./13-udevadm命令详解.md)。
