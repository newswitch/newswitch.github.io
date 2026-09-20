---
title: "Linux 系统启动导读：从按下电源到服务可用"
sidebar_label: "00. Linux 系统启动导读"
sidebar_position: 0
description: "建立固件、Bootloader、内核、initramfs、根文件系统、PID 1 与服务之间的完整启动链路。"
tags: [Linux, 启动, UEFI, GRUB, initramfs, systemd]
---

# Linux 系统启动导读：从按下电源到服务可用

“机器能 ping 通”“SSH 能连接”“业务服务正常”对应启动链路中的不同完成点。定位启动故障，首先要判断控制权停在哪一层，而不是笼统地说“系统起不来”。

## 1. 完整启动链路

```mermaid
flowchart LR
    P["上电/复位"] --> F["BIOS/UEFI<br/>硬件初始化"]
    F --> B["Bootloader<br/>GRUB"]
    B --> K["Linux 内核<br/>解压与初始化"]
    K --> I["initramfs<br/>发现根设备"]
    I --> R["真实根文件系统"]
    R --> S["PID 1 / systemd"]
    S --> U["基础服务、网络、登录"]
    U --> A["应用服务"]
```

每一段都有不同的日志和恢复工具：固件界面、串口/IPMI SOL、GRUB 控制台、内核日志、initramfs emergency shell、journal 和服务日志。

## 2. 启动阶段与证据

| 阶段 | 主要任务 | 常见证据 |
|---|---|---|
| 固件 | CPU/内存训练、枚举设备、选择启动项 | BMC SEL、POST Code、UEFI 日志 |
| Bootloader | 找到内核和 initramfs，传递命令行 | GRUB 菜单、串口输出、配置文件 |
| 内核早期 | 解压、页表、内存、调度、中断、驱动框架 | `dmesg` 早期日志、`/proc/cmdline` |
| initramfs | 加载关键驱动，组装存储，找到根文件系统 | dracut/initramfs shell、`rd.*` 参数 |
| PID 1 | 挂载、设备管理、服务依赖和登录 | `journalctl -b`、`systemd-analyze` |
| 应用 | 服务监听、依赖就绪和业务恢复 | Unit 状态、端口、探针、业务指标 |

## 3. 启动不是简单的串行脚本

固件和 Bootloader 基本按阶段移交控制权；进入 systemd 后，大量 Unit 根据依赖关系并行启动。某服务启动晚，不一定是它自身执行慢，也可能是：

- 等待必要设备或挂载点。
- `After=` 排序链过长。
- 网络“已配置”和网络“真正可用”的定义不同。
- 应用前台进程已启动，但内部恢复尚未完成。
- 自动挂载、Socket 激活或设备激活改变了时间点。

`systemd-analyze blame` 只显示 Unit 自身激活耗时，不能单独证明关键路径。

## 4. 当前系统怎样启动

```bash
test -d /sys/firmware/efi && echo UEFI || echo 'Legacy BIOS or EFI interface unavailable'
cat /proc/cmdline
findmnt /
lsinitrd 2>/dev/null | head
systemd-analyze time
systemd-analyze critical-chain
journalctl -b -p warning
```

示例：

```text
Startup finished in 8.412s (firmware) + 2.303s (loader) +
3.924s (kernel) + 9.118s (userspace) = 23.758s
multi-user.target reached after 8.731s in userspace.
```

这只是 systemd 能获得的计时边界。虚拟机、容器、休眠恢复以及缺失固件时间信息时，字段可能不同。

## 5. 先判断故障层次

| 最后可见现象 | 优先检查 |
|---|---|
| 无 POST、BMC 报硬件错误 | 电源、主板、CPU、内存、固件 |
| 能进 UEFI 但没有启动项 | ESP、磁盘识别、NVRAM Boot Entry |
| GRUB 出现但找不到内核 | `/boot`、GRUB 配置、文件系统 |
| 出现内核日志后 Panic | 内核参数、驱动、根设备、硬件 |
| 进入 dracut emergency shell | 根设备、LVM/RAID、加密、存储驱动 |
| systemd emergency mode | `/etc/fstab`、Unit 依赖、文件系统检查 |
| SSH 不通但控制台可登录 | 网络、sshd、防火墙、地址配置 |
| Unit active 但业务不可用 | 应用恢复、依赖、监听和健康检查 |

## 6. 练习与答案

**问题：看到 systemd 日志能否证明 initramfs 没有问题？**

答案：至少说明内核已经找到了可用根文件系统并执行了真实根中的 PID 1；但 initramfs 可能有性能、冗余路径或驱动告警，仍需检查早期日志。

**问题：`systemd-analyze blame` 排名第一的 Unit 一定是启动变慢根因吗？**

答案：不一定。它不等于关键路径，也不能完整表达设备等待、并行关系和 Unit 内部异步初始化，应结合 `critical-chain`、journal 和依赖图。

下一篇：[固件、UEFI 与 Bootloader](./01-固件UEFI与Bootloader.md)
