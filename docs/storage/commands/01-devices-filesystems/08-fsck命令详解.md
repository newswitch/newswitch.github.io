---
title: "fsck 命令详解：文件系统检查前端、离线修复与安全边界"
sidebar_label: "08. fsck 命令详解：文件系统检查前端、离线修复与安全边界"
sidebar_position: 8
description: "讲解 fsck 前端如何调用 fsck.type、fstab pass、并行检查、参数、退出码、已挂载文件系统风险，以及 ext4、XFS 和根文件系统恢复流程。"
tags: [Linux, fsck, 文件系统, ext4, XFS, util-linux]
---

# fsck 命令详解：文件系统检查前端、离线修复与安全边界

`fsck` 是前端调度器，不是通用修复算法。它根据文件系统类型调用 `/sbin/fsck.TYPE`，例如 `fsck.ext4`。XFS 通常由 `xfs_repair` 处理，Btrfs/ZFS 也有独立工具和完全不同的恢复语义。

> 除非目标 checker 明确支持在线只读检查，否则不要对已读写挂载文件系统运行修复。

## 1. 执行前证据

```bash
fsck --version
lsblk -f
findmnt -S /dev/mapper/vg0-data
blkid /dev/mapper/vg0-data
```

确认：精确设备、文件系统类型、是否挂载、底层 RAID/LVM 是否健康、是否有备份、是否需要先 snapshot/image。

## 2. fsck 前端参数

| 参数 | 作用与边界 |
|---|---|
| `-A` | 按 fstab 检查，依据第六字段 passno 排序 |
| `-C [fd]` | 显示进度条/指定文件描述符，checker 需支持 |
| `-M` | 跳过已挂载文件系统 |
| `-N` | 不执行，只打印将运行的命令；适合审计 |
| `-P` | 与 `-A` 配合并行检查 root，风险较高 |
| `-R` | 与 `-A` 配合跳过 root |
| `-T` | 不显示标题 |
| `-V` | verbose，显示文件系统专用命令 |
| `-t list` | 按文件系统类型/选项筛选，可用 `noTYPE`/`opts=` |
| `-s` | 串行检查 |
| `-l` | 锁定整个磁盘，避免同盘并发 checker |
| `-r [fd]` | 报告结果统计，支持依 checker |
| `--` | 后续参数传给专用 checker |

`-a/-p/-n/-y/-f` 等经常是传给专用 checker 的参数，含义并非所有文件系统一致：

```bash
man fsck.ext4
man xfs_repair
```

尤其 `-y` 自动接受所有修复，可能把“可恢复但需人工判断”的元数据变更成不可逆结果。

## 3. fstab passno

```fstab
UUID=root /         ext4 defaults 0 1
UUID=data /srv/data ext4 defaults 0 2
```

`passno=1` 通常用于 root，`2` 用于其他本地文件系统，`0` 不自动检查。不同物理盘可并行，同一盘并发会增加寻道/恢复风险；现代 SSD/LVM/云盘也不能只看设备名判断故障域。

## 4. 退出码位图

常见 fsck 前端退出码可组合：

| 位 | 含义 |
|---:|---|
| 0 | 无错误 |
| 1 | 错误已修复 |
| 2 | 应重启系统 |
| 4 | 错误未修复 |
| 8 | 运行错误 |
| 16 | 使用/语法错误 |
| 32 | 用户取消 |
| 128 | shared-library error |

脚本必须按位解释，不能简单把非零都当同一种失败。

## 5. 安全恢复流程

```bash
# 仅展示计划
sudo fsck -N -V /dev/mapper/vg0-data

# 在维护环境、确认未挂载后做 checker 的只读检查
sudo fsck.ext4 -n /dev/mapper/vg0-data
```

然后根据备份、镜像、硬件健康和 checker 输出决定修复。若底层盘持续报 I/O error，应先保护副本/镜像故障设备；反复 fsck 不能修复介质失效。

XFS 不应照抄 `fsck -y`：`fsck.xfs` 常只是提示；实际需要 `xfs_repair`，`-L` 清日志可能丢失未落盘元数据事务，必须单独评估。

## 6. 常见误区

- 文件系统变只读就立即修复：先查 kernel I/O、NVMe/SMART、RAID 和 hypervisor。
- 在 mounted root 上修复：进入救援环境或按发行版启动流程安排离线检查。
- fsck 成功等于数据正确：它主要恢复结构一致性，不验证业务内容语义。
- 直接修复唯一副本：有条件先块级镜像或 snapshot，并记录原始日志。

完成标准：能指出实际 checker、检查挂载状态、解释退出码位图，并给出备份—只读检查—修复—重新挂载—业务校验的完整流程。

参考：[util-linux fsck 上游](https://github.com/util-linux/util-linux)和各文件系统官方恢复文档。
