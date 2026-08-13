---
title: lspci 命令详解：读懂 BDF、PCIe 能力、链路与驱动绑定
sidebar_position: 9
description: 完整讲解 lspci 的全部参数、BDF 与 ID、拓扑树、配置空间、PCIe 链路能力和状态、AER/ACS/SR-IOV，以及 GPU/NIC/NVMe 排障。
tags: [Linux, lspci, PCIe, GPU, 网卡, NVMe]
---

# `lspci` 命令详解：读懂 BDF、PCIe 能力、链路与驱动绑定

`lspci` 由 pciutils 提供，用来枚举 PCI/PCIe function、读取配置空间并解码 capability。GPU、NIC、NVMe、HBA 与加速卡的“系统是否枚举、插在哪棵树、以什么速率连接、绑定哪个驱动”都从它开始。

## 1. 先掌握 BDF

```text
0000:3b:00.0
^^^^ ^^ ^^ ^
域   总线 设备 function
```

domain:bus:device.function 合称 BDF，是一次启动内稳定的内核 PCI 地址，不等于设备序列号。热插拔、固件和 BIOS 配置变化后 BDF 可能改变。

```bash
lspci -Dnn
lspci -s 0000:3b:00.0 -nnk
```

## 2. 全部参数

### 2.1 输出格式与详细度

| 参数 | 含义 |
|---|---|
| `-m` | 旧式单行机器可读格式 |
| `-mm` | 更易解析的机器可读格式；字段顺序可能扩展 |
| `-t` | 显示 PCI 总线树 |
| `-v`、`-vv`、`-vvv` | 逐级增加详细度，能力解码需要相应权限 |
| `-k` | 显示实际使用的 kernel driver 与候选 modules |
| `-x` | dump 配置空间标准 64 字节 |
| `-xxx` | dump 256 字节 PCI 配置空间 |
| `-xxxx` | dump 4096 字节 PCIe 扩展配置空间；少数故障设备读取可能不安全 |
| `-b` | 以 bus-centric 视角显示 IRQ/地址，而非内核重映射值 |
| `-D` | 总是显示 domain |
| `-P` | 以 bridge path 标识设备 |
| `-PP` | 显示更完整的 bridge path |

### 2.2 名称、ID 与查询

| 参数 | 含义 |
|---|---|
| `-n` | 用十六进制 vendor/device/class ID，不解析名称 |
| `-nn` | 同时显示名称与十六进制 ID，排障最常用 |
| `-q` | 本地 `pci.ids` 未知时通过 DNS 查询名称 |
| `-qq` | 也重新查询本地已有条目 |
| `-Q` | 直接查中央数据库并覆盖本地识别；需网络 |
| `-i FILE` | 指定 `pci.ids` 文件 |
| `-p FILE` | 指定内核模块映射文件，默认 modules.pcimap |

名称数据库会更新，硬件 ID 才是稳定排障键；自动化优先 `-n/-nn`，不要依赖翻译后的产品字符串。

### 2.3 设备选择

| 参数 | 含义 |
|---|---|
| `-s [[[[DOMAIN]:]BUS]:][DEVICE][.FUNCTION]` | 按 BDF 选择；字段可省略或使用 `*` 表示任意值 |
| `-d [VENDOR]:[DEVICE][:CLASS[:PROGIF]]` | 按十六进制 ID 选择，任意字段可为空或 `*` |

```bash
lspci -nn -d 10de:          # NVIDIA vendor
lspci -nn -d ::0200         # Ethernet class
lspci -s 3b:00.0 -vv
```

### 2.4 访问方式与诊断

| 参数 | 含义 |
|---|---|
| `-A METHOD` | 指定 PCI 访问方法；`-A help` 列出 |
| `-O NAME=VALUE` | 设置 PCI library 参数；`-O help` 列出 |
| `-H1`、`-H2` | Intel x86 上直接硬件访问机制 1/2，通常需 root |
| `-F FILE` | 从先前 `lspci -x` 兼容 dump 读取，而非访问本机 |
| `-M` | bus mapper 模式，扫描配置错误的桥；仅 root，可能扰动系统 |
| `-G` | PCI library debug |
| `--version` | 显示 pciutils 版本 |

## 3. 最常用的证据组合

```bash
lspci -Dnnk
lspci -tv
sudo lspci -s 0000:3b:00.0 -vv
readlink -f /sys/bus/pci/devices/0000:3b:00.0/driver
cat /sys/bus/pci/devices/0000:3b:00.0/numa_node
```

`Kernel modules` 是候选，`Kernel driver in use` 才是实际绑定；最终以 sysfs driver symlink 为准。

## 4. PCIe 链路降级怎么看

在设备及其上游端口的 `-vv` 输出中比较：

- `LnkCap`：端点/端口最大能力；
- `LnkSta`：当前协商 speed 与 width；
- `LnkCap2/LnkSta2`：更高代际和均衡信息；
- `Sta`/`DevSta`：错误状态；
- 上游 bridge 的能力也会限制端点。

```bash
sudo lspci -s 3b:00.0 -vv | grep -E 'LnkCap:|LnkSta:'
lspci -t
```

只有端点 `x16` 能力而上游口仅 `x8`，最终就是 `x8`。链路空闲时降速可能是 ASPM 节能，需在负载下复核；宽度永久下降则查插槽布线、共享 lane、riser、接触、固件和错误日志。

## 5. AER、ACS、IOMMU 与 SR-IOV

```bash
sudo lspci -s BDF -vv | grep -A15 -E 'Advanced Error|Access Control|SR-IOV|IOMMU'
dmesg -T | grep -iE 'aer|pcie|dpc|iommu|vfio'
find /sys/kernel/iommu_groups -type l -name "*${BDF}*" -print
```

- AER capability 是错误记录能力，不等于当前发生错误；结合 status 与日志；
- ACS 影响 peer-to-peer 隔离和 IOMMU group，但真实路径受全部上游端口决定；
- SR-IOV capability 不代表固件、驱动和 `sriov_numvfs` 已启用；
- `lspci` 只看 PCIe 层，GPU NVLink/NVSwitch 等另有专用拓扑工具。

## 6. 安全与自动化

- 普通枚举通常只读；`-xxx/-xxxx/-M/-H*` 扩大硬件访问面，生产慎用；
- 设备在低功耗或损坏状态时，扩展配置读取可能返回全 `ff`，极少数硬件甚至异常；
- 脚本显式使用 `-D -n/-nn -mm`，不要解析默认名称；
- 采集配置空间 dump 可能包含拓扑和设备信息，外发前脱敏。

## 7. 官方参考

- [pciutils：lspci(8)](https://man7.org/linux/man-pages/man8/lspci.8.html)
- [PCI utilities 官方仓库](https://git.kernel.org/pub/scm/utils/pciutils/pciutils.git/)

下一篇：[setpci 命令详解](./10-setpci命令详解.md)。
