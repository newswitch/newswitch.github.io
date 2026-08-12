---
title: switch_root 命令详解：从 initramfs 切换到真实根文件系统
sidebar_position: 9
description: 讲清 switch_root 的启动期用途、rootfs 内存释放、console、init 参数、与 pivot_root/chroot 的区别和救援排障。
tags: [Linux, switch_root, initramfs, 启动, util-linux]
---

# `switch_root` 命令详解：从 initramfs 进入真实根

`switch_root` 用在早期启动：把 `/proc`、`/dev`、`/sys`、`/run` 等挂载移入 `NEW_ROOT`，删除当前 initramfs root 的内容以释放内存，切根并执行真正的 init。它会递归删除旧 root 内容，属于 `[D]`，不是日常 chroot 工具。

## 1. 语法与参数

```text
switch_root [options] NEW_ROOT NEW_INIT [ARG...]
```

| 参数 | 含义 |
|---|---|
| `-c, --console DEV` | 切换后把标准输入/输出/错误连接到控制台设备 |
| `-h, --help` | 显示帮助 |
| `-V, --version` | 显示版本 |

`NEW_ROOT` 必须是挂载点；`NEW_INIT` 必须存在且可执行。当前进程应是 PID 1，当前根通常是 initramfs 的 ramfs/tmpfs。

## 2. 与另外两个工具的边界

| 工具 | 典型场景 | 是否处理旧根 |
|---|---|---|
| `chroot` | 修复环境、改变路径解析根 | 旧根仍存在，不处理挂载树 |
| `pivot_root` | 容器/Namespace 中交换根挂载 | 把旧根移到 PUT_OLD，调用者再卸载 |
| `switch_root` | initramfs PID 1 交接真实 init | 删除旧 root，移动关键挂载并 exec init |

不要在正常运行的宿主系统尝试 `switch_root`。学习实验应在可丢弃 VM 的自制 initramfs 或 QEMU 中完成。

## 3. 启动故障证据链

在 initramfs emergency shell 中先只读确认：

```bash
cat /proc/cmdline
findmnt
lsblk -f
ls -l /newroot/sbin/init
file /newroot/sbin/init
readelf -l /newroot/sbin/init | grep interpreter
```

| 症状 | 检查 |
|---|---|
| 找不到 root device | 驱动模块、LVM/MD/crypt 激活、root= 参数 |
| `NEW_ROOT is not a mountpoint` | 是否只建了目录而未真正 mount |
| init 存在仍 ENOENT | ELF interpreter/共享库缺失或架构不符 |
| 无 console | `/dev` 是否就绪，`-c` 设备和内核 console 参数 |
| 启动后 proc/sys 异常 | 关键伪文件系统是否正确移动 |

## 4. 掌握标准与参考

能解释 initramfs 为什么不能简单 `chroot` 后启动 systemd；能按“块设备 → 解锁/组装 → 文件系统 → init 解释器 → 关键挂载 → exec”定位启动失败。

- [util-linux：switch_root(8)](https://man7.org/linux/man-pages/man8/switch_root.8.html)
- [Linux Kernel：initramfs buffer format](https://docs.kernel.org/driver-api/early-userspace/buffer-format.html)

下一篇：[ipcs 命令详解](./10-ipcs命令详解.md)。
