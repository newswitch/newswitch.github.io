---
title: dmidecode 命令详解：解析 SMBIOS、内存插槽与服务器固件资产
sidebar_position: 11
description: 完整讲解 dmidecode 的全部参数、SMBIOS 类型、内存 DIMM 与插槽映射、句柄关联、固件可信边界、二进制 dump 和敏感字段治理。
tags: [Linux, dmidecode, SMBIOS, DMI, 服务器硬件]
---

# `dmidecode` 命令详解：解析 SMBIOS、内存插槽与服务器固件资产

`dmidecode` 读取固件提供的 SMBIOS/DMI 表，把系统、主板、机箱、处理器、内存槽和扩展槽记录解码成人类可读文本。它展示的是**固件声明**，不是实时探测；字段可能为空、错误、复制或在虚拟机中由 hypervisor 合成。

## 1. 语法与全部参数

```text
dmidecode [OPTIONS]
```

| 参数 | 含义 |
|---|---|
| `-d FILE`、`--dev-mem FILE` | 从指定设备读取，默认 `/dev/mem` |
| `-q`、`--quiet` | 减少未知/未激活/部分元数据输出 |
| `-s KEYWORD`、`--string KEYWORD` | 只输出支持的 DMI 字符串；`dmidecode -s` 列出关键字 |
| `-t TYPE`、`--type TYPE` | 只显示类型编号或类别，可逗号分隔 |
| `-H HANDLE`、`--handle HANDLE` | 只显示指定十六进制 record handle |
| `-u`、`--dump` | 不解码字段，显示原始十六进制数据 |
| 无 | `--dump-bin FILE` | 把 DMI 数据保存为二进制文件 |
| 无 | `--from-dump FILE` | 从 `--dump-bin` 文件解码，适合离线分析 |
| 无 | `--no-sysfs` | 不从 sysfs 读取，改用传统内存扫描 |
| 无 | `--oem-string N` | 输出第 N 个 OEM string；不带 N 列出全部 |
| 无 | `--no-quirks` | 不应用已知固件兼容修正，通常只用于诊断 dmidecode 本身 |
| `-V`、`--version` | 显示版本 |
| `-h`、`--help` | 显示帮助 |

不同版本对新 SMBIOS 类型的解码能力不同，先记录 `dmidecode --version`。

## 2. 常用 type

| Type | 对象 | 常见用途 |
|---:|---|---|
| 0 | BIOS Information | 厂商、版本、发布日期 |
| 1 | System Information | 型号、序列号、UUID |
| 2 | Baseboard | 主板型号和序列号 |
| 3 | Chassis | 机箱与资产标签 |
| 4 | Processor | socket、family、core/thread 声明 |
| 9 | System Slots | 插槽名、类型、宽度、占用声明 |
| 16 | Physical Memory Array | 内存阵列容量和槽位数 |
| 17 | Memory Device | 每条 DIMM 的 locator、容量、速率、厂商 |
| 19/20 | Memory Mapped Address | 物理地址到阵列/设备映射 |

类别名包括 `bios`、`system`、`baseboard`、`chassis`、`processor`、`memory`、`cache`、`connector`、`slot`：

```bash
sudo dmidecode -t system
sudo dmidecode -t memory
sudo dmidecode -t 9,17
```

## 3. 内存条盘点：不要只 grep Size

```bash
sudo dmidecode -t 17
```

逐条记录：`Handle`、`Locator/Bank Locator`、`Size`、`Type`、`Configured Memory Speed`、`Manufacturer`、`Part Number`、`Serial Number`、rank 与 error handle。`No Module Installed` 与 `Unknown` 含义不同。

再与运行态交叉验证：

```bash
lsmem
numactl --hardware
grep -E 'MemTotal|HardwareCorrupted' /proc/meminfo
edac-util -v 2>/dev/null
```

SMBIOS 槽位总量不等于 Linux 当前 online memory；固件保留、热插拔、坏页、虚拟化 balloon 都会造成差异。

## 4. 句柄是关联记录的钥匙

输出中的 `Handle 0x....` 是 SMBIOS 表内关联标识。若 Type 17 引用 array/error handle，可用：

```bash
sudo dmidecode -H 0x0042
```

它不是跨重启稳定资产 ID，也不是物理地址。

## 5. 字符串模式适合资产脚本

```bash
sudo dmidecode -s system-manufacturer
sudo dmidecode -s system-product-name
sudo dmidecode -s system-serial-number
sudo dmidecode -s system-uuid
sudo dmidecode -s bios-version
```

先运行 `dmidecode -s` 获取本版本支持的完整 keyword。注意厂商可能填入 `To Be Filled By O.E.M.`，UUID/serial 也可能重复，不能单独作为强身份认证依据。

## 6. 离线采集与敏感信息

```bash
sudo dmidecode --dump-bin host.dmi
dmidecode --from-dump host.dmi -t 17
```

二进制 dump 可能包含序列号、UUID、资产标签和 OEM 字符串，应按资产敏感数据控制权限、传输和留存。公开博客/工单要脱敏。

## 7. 三类常见误判

- **SMBIOS 不是传感器**：温度、当前功耗与实时链路状态另查 BMC/hwmon/PCIe。
- **Slot 记录不是枚举结果**：Type 9 显示固件槽位描述，实际 PCI function 看 `lspci -t`。
- **速度字段有多个**：`Speed` 可能是额定能力，`Configured Memory Speed` 才接近配置值，仍需 EDAC/厂商工具复核。

## 8. 官方参考

- [dmidecode 官方项目](https://www.nongnu.org/dmidecode/)
- [dmidecode(8)](https://man7.org/linux/man-pages/man8/dmidecode.8.html)

下一篇：[lshw 命令详解](./12-lshw命令详解.md)。
