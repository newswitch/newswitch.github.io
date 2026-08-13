---
title: lsmod 命令详解：读取已加载模块、依赖者与引用计数
sidebar_position: 3
description: 完整讲解 lsmod 的全部参数、/proc/modules 字段、内建驱动与可加载模块的区别，以及模块卸载前的证据链。
tags: [Linux, lsmod, kmod, 内核模块, 驱动]
---

# `lsmod` 命令详解：读取已加载模块、依赖者与引用计数

`lsmod` 展示**当前内核已经加载的可加载模块**。它本质上只是把 `/proc/modules` 格式化为三列，并不扫描磁盘上的 `.ko`，也不会显示直接编进内核的 built-in 驱动。

## 1. 语法与全部参数

```text
lsmod [OPTIONS...]
```

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-s` | `--syslog` | 错误写入 syslog，而不是标准错误 |
| `-v` | `--verbose` | 详细模式；当前实现保留兼容性，通常不增加输出 |
| `-V` | `--version` | 显示 kmod 版本 |
| `-h` | `--help` | 显示帮助 |

```bash
lsmod
lsmod | grep -E '^(nvidia|mlx5|nvme)'
```

## 2. 三列到底表示什么

```text
Module                  Size  Used by
mlx5_core            2252800  2 mlx5_ib
```

| 列 | 解释 | 容易误判的地方 |
|---|---|---|
| `Module` | 模块名；文件名中的 `-` 常规范化为 `_` | 不等于 PCIe 设备名 |
| `Size` | 模块在内核中的近似内存大小 | 不等于 `.ko` 文件大小，也不是驱动总占用 |
| `Used by` | 引用计数及部分依赖模块 | 计数为 0 不代表一定可以安全卸载 |

原始记录还能看到模块状态和地址：

```bash
grep '^mlx5_core ' /proc/modules
```

## 3. 四种“看不见”

`lsmod` 没有输出某驱动，可能是：

1. 模块确实没加载；
2. 驱动编进了内核，记录在 `modules.builtin`；
3. 当前内核没有安装该模块文件；
4. 你在容器里看到宿主机共享的内核，但 `/lib/modules` 没有挂载进容器。

```bash
grep -w 'kernel/drivers/nvme/host/nvme.ko' \
  "/lib/modules/$(uname -r)/modules.builtin"
modinfo nvme
```

## 4. 从模块追到设备

“模块已加载”不等于“模块已绑定目标设备”。PCIe 设备要继续看：

```bash
lspci -nnk
readlink -f /sys/bus/pci/devices/0000:3b:00.0/driver
ls -l /sys/module/mlx5_core/drivers/
```

- `Kernel modules`：可匹配的候选模块；
- `Kernel driver in use`：当前实际绑定的驱动；
- `/sys/.../driver`：最直接的绑定证据。

## 5. 卸载前不能只看引用计数

```bash
lsmod | grep '^MODULE '
modprobe --show-depends MODULE
ls -l /sys/module/MODULE/holders/
find /sys/module/MODULE/drivers -maxdepth 2 -type l 2>/dev/null
```

还要确认文件系统、网卡、块设备、GPU 作业、VFIO consumer 与容器没有使用它。模块可能通过内核内部资源持有状态，而不完整反映在 `Used by` 文本里。

## 6. 自动化与排障模板

```bash
module=nvidia
if lsmod | awk 'NR>1 {print $1}' | grep -Fxq "$module"; then
  echo "loaded"
else
  echo "not listed; check built-in and modinfo"
fi
```

不要用 `grep nvidia` 做严格判断，它会匹配 `nvidia_drm` 等其他行。排障时把状态、元数据、日志和绑定放在一起：

```bash
uname -r
lsmod | grep -E '^(nvidia|nvidia_drm|nvidia_uvm)'
modinfo nvidia | grep -E '^(filename|version|vermagic|signer|parm):'
dmesg --level=err,warn | tail -n 100
lspci -nnk | grep -A3 -i nvidia
```

## 7. 常见误区

- `lsmod` 不是驱动清单：built-in 驱动不会出现。
- `Used by 0` 不是卸载许可：先检查设备和业务。
- 同名模块文件存在不代表已加载；已加载也不代表已绑定。
- 容器不能拥有独立内核模块集合；加载动作作用于宿主机内核，通常需要高权限。

## 8. 官方参考

- [kmod：lsmod(8)](https://www.kernel.org/pub/linux/utils/kernel/kmod/)
- [Linux 内核：模块 sysfs](https://docs.kernel.org/)

下一篇：[modinfo 命令详解](./04-modinfo命令详解.md)。
