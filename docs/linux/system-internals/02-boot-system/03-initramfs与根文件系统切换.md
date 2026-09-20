---
title: "initramfs 与根文件系统切换：Linux 为什么需要两段用户空间"
sidebar_label: "03. initramfs 与根文件系统切换"
sidebar_position: 3
description: "解释 initramfs 如何加载驱动、发现 LVM/RAID/加密根设备，并通过 switch_root 进入真实系统。"
tags: [Linux, initramfs, dracut, switch_root, rootfs]
---

# initramfs 与根文件系统切换：Linux 为什么需要两段用户空间

很多服务器的根文件系统位于 LVM、软件 RAID、SAN、多路径或加密设备上。要访问真实根，必须先加载驱动和组装存储；但这些工具又存放在根文件系统中。initramfs 用一个内存中的临时用户空间解决这个先后依赖。

## 1. initramfs 中有什么

initramfs 通常是压缩的 cpio 归档，包含：

- `/init` 早期入口程序或脚本。
- 必要内核模块及固件。
- udev 和设备发现规则。
- LVM、MD RAID、multipath、cryptsetup 等工具。
- 最小 Shell 和故障恢复命令。
- 定位根设备所需配置。

```bash
lsinitrd /boot/initramfs-"$(uname -r)".img | less
```

不同发行版可能使用 dracut、initramfs-tools 或其他生成器，命令和内部结构会不同。

## 2. 两段根文件系统

```mermaid
flowchart LR
    K["内核内置 rootfs"] --> U["解包 initramfs"]
    U --> INIT["执行 /init"]
    INIT --> MOD["加载驱动/发现设备"]
    MOD --> ASM["组装 RAID/LVM/加密/多路径"]
    ASM --> M["挂载真实根"]
    M --> SW["switch_root"]
    SW --> PID1["执行真实 /sbin/init"]
```

`switch_root` 把真实根变为 `/`，处理旧根中的挂载并执行新 init。它与 `pivot_root` 相关但语义和适用环境不同，不能只把它理解成 `cd /newroot`。

## 3. 怎样定位根设备

根设备可以由设备名、UUID、LABEL、LVM 逻辑卷等指定。直接使用 `/dev/sda2` 在设备枚举顺序变化时不稳定，生产系统通常使用 UUID 或稳定映射。

```bash
cat /proc/cmdline
findmnt -no SOURCE,FSTYPE,OPTIONS /
lsblk -o NAME,TYPE,FSTYPE,UUID,MOUNTPOINTS
blkid
```

如果根依赖网络存储，还要在早期用户空间完成网卡驱动、网络配置、认证和存储发现，这会显著扩大 initramfs 的依赖面。

## 4. 为什么进入 emergency shell

常见原因：

- `root=` 指向错误 UUID 或逻辑卷。
- 存储/HBA/NVMe 驱动没被打进 initramfs。
- LVM、RAID、多路径或加密配置缺失。
- 根文件系统损坏或类型模块缺失。
- 修改了硬件、控制器模式或磁盘拓扑。
- initramfs 与所选内核模块版本不匹配。

在恢复 Shell 中应先保存日志，再检查 `/proc/cmdline`、`/dev`、`lsblk`、LVM/RAID 状态和已加载模块。盲目重建 initramfs 可能掩盖真实问题或覆盖唯一可用镜像。

## 5. initrd 和 initramfs

历史 initrd 常被视为一个内存块设备上的文件系统映像；initramfs 是解包到内核 rootfs 的 cpio 内容。现代文档、文件名和启动参数中仍可能混用“initrd”这一名称，分析时要看实际格式和启动机制，而不是只按文件名判断。

## 6. 安全更新流程

更新存储驱动、内核或启动配置时：

1. 保留至少一个已验证可启动内核和 initramfs。
2. 生成新镜像后检查内容，不只检查文件是否存在。
3. 确认 Bootloader 菜单项引用匹配版本。
4. 保证有物理或带外控制台。
5. 先在同类硬件验证冷启动，而不是只执行在线重载。
6. 记录回退方法。

## 7. 练习与答案

**问题：为什么 `root=UUID=...` 正确仍可能找不到根文件系统？**

答案：UUID 只标识目标。内核和 initramfs 仍需要识别控制器、发现设备、组装中间层并支持目标文件系统，任何一层缺失都会失败。

**问题：更新磁盘驱动模块后，为什么还可能需要重建 initramfs？**

答案：启动早期使用的是 initramfs 中的模块副本，不一定是根文件系统 `/lib/modules` 下刚更新的文件。

下一篇：[PID 1 与 systemd](./04-PID1与systemd.md)
