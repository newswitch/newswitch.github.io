---
title: "固件、UEFI 与 Bootloader：控制权如何交给 Linux"
sidebar_label: "01. 固件、UEFI 与 Bootloader"
sidebar_position: 1
description: "解释服务器上电、UEFI 启动项、ESP、Secure Boot、GRUB、内核和 initramfs 的交接关系。"
tags: [Linux, UEFI, BIOS, GRUB, Secure Boot, ESP]
---

# 固件、UEFI 与 Bootloader：控制权如何交给 Linux

Linux 内核并不是上电后第一段执行的软件。固件先把硬件带到可用状态，再从启动介质加载一个可执行引导程序，最后才由 Bootloader 装入内核和 initramfs。

## 1. 上电到固件完成

典型服务器会经历：

```text
电源稳定/复位
→ CPU 从复位向量执行固件
→ 内存训练与初始化
→ 初始化芯片组和必要总线
→ 枚举可启动设备
→ 执行安全策略和启动顺序
→ 加载 Bootloader
```

BMC 与主机 CPU 是两个不同管理域。BMC 可以在主机 OS 尚未启动时记录 SEL、提供远程 KVM/SOL、控制电源；因此“BMC 可登录”不能证明 Linux 或主机 CPU 正常。

## 2. Legacy BIOS 与 UEFI

Legacy BIOS 常从磁盘开头的引导代码逐级加载；UEFI 能识别 GPT 和 EFI System Partition（ESP），按照 NVRAM 中的 `Boot####` 条目加载 `.efi` 程序。现代服务器通常使用 UEFI。

```bash
test -d /sys/firmware/efi && echo 'booted via UEFI'
findmnt /boot/efi
efibootmgr -v 2>/dev/null
```

典型 ESP 是 FAT 文件系统，包含类似：

```text
/EFI/BOOT/BOOTX64.EFI
/EFI/rocky/shimx64.efi
/EFI/rocky/grubx64.efi
```

路径随发行版和架构变化。ESP 可挂载不代表 NVRAM 启动项一定指向正确文件。

## 3. Secure Boot 信任链

Secure Boot 不是磁盘加密。它通过签名验证限制固件加载的 EFI 程序，并可继续验证 Bootloader、内核和模块：

```text
平台信任数据库
→ 验证 shim/Bootloader
→ 验证 Linux 内核
→ 内核策略验证可加载模块
```

第三方 GPU/NPU/网卡驱动模块未签名或密钥未注册时，可能在开启 Secure Boot 后拒绝加载。故障表面会表现为设备不可用，而不是“Secure Boot 页面报错”。

## 4. GRUB 做什么

GRUB 通常负责：

- 读取配置并显示多个启动项。
- 加载选定的内核映像。
- 加载配套 initramfs。
- 组成内核命令行。
- 把内存布局和必要信息交给内核入口。

示例菜单项的逻辑内容：

```text
linux /vmlinuz-6.6.x root=UUID=... ro console=tty0 console=ttyS0,115200
initrd /initramfs-6.6.x.img
```

`root=` 告诉早期用户空间最终根文件系统在哪里；`console=` 决定日志输出目标。远程服务器没有串口 console 参数时，内核可能已报错但 SOL 看不到。

## 5. 为什么内核和 initramfs 必须匹配

内核可以把部分驱动编译为内置，也可以在启动后从模块加载。如果访问根磁盘所需的 RAID、LVM、加密、HBA 或文件系统驱动是模块，就必须先放进 initramfs；否则真实根文件系统尚未挂载，内核也无处读取模块。

更新内核时只复制 `vmlinuz`、没有生成配套 initramfs 和模块目录，会形成典型的“Bootloader 能加载，内核找不到根设备”。

## 6. 故障定位

| 现象 | 可能层次 | 证据 |
|---|---|---|
| 启动项消失 | UEFI NVRAM、磁盘或 ESP | `efibootmgr -v`、固件界面 |
| `grub>` 提示符 | 配置或 `/boot` 路径 | `ls`、`set`、GRUB 配置 |
| 内核签名验证失败 | Secure Boot 信任链 | 固件提示、内核/Bootloader 日志 |
| 新内核无法启动、旧内核正常 | initramfs、驱动、参数或内核回归 | 对比菜单项、initramfs 内容、日志 |
| 本地屏幕有日志、SOL 无日志 | console 参数或串口设置 | `/proc/cmdline`、BMC SOL 设置 |

修改启动项和重建 GRUB 配置有使机器不可启动的风险，应保留可用旧内核、控制台和带外访问，并确认不同发行版的生成方式。

## 7. 练习与答案

**问题：UEFI 能看到 NVMe，是否证明 Linux 一定能从它挂载根文件系统？**

答案：不能。固件能读取启动文件只证明固件路径可用；Linux 还需要匹配的控制器驱动、存储拓扑支持、文件系统模块和正确 `root=` 参数。

**问题：Secure Boot 和 LUKS 各解决什么问题？**

答案：Secure Boot 主要验证启动代码信任链；LUKS 保护块设备上的静态数据。两者可以组合，但不能互相替代。

下一篇：[内核早期初始化](./02-内核早期初始化.md)
