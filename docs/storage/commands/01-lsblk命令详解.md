---
title: lsblk 命令详解：块设备拓扑、文件系统与机器可读输出
sidebar_position: 1
description: 讲解 lsblk 的 sysfs/udev 数据来源、树形关系、全部常用参数族、列选择、JSON、去重、过滤，以及 LVM、RAID、NVMe 和容器场景排查。
tags: [Linux, lsblk, 块设备, util-linux, NVMe, LVM]
---

# `lsblk` 命令详解：块设备拓扑、文件系统与机器可读输出

`lsblk` 读取 sysfs、udev database 和文件系统探测信息，把内核块设备表示成“磁盘 → 分区 → MD/LVM/加密 → 文件系统 → 挂载点”的关系树。它是只读命令，但输出不是持久配置，也不保证 udev 刚收到设备事件时已经完全收敛。

## 1. 版本与对象

```bash
lsblk --version
lsblk --help
udevadm settle
lsblk
```

本文按 util-linux 2.42.2 编写。默认列会随版本变化，生产脚本必须显式指定 `--output`。

```text
NAME     内核设备名       TYPE    disk/part/lvm/raid/crypt/loop
MAJ:MIN  块设备号         PKNAME  直接父设备
SIZE     设备容量         FSTYPE  文件系统/签名类型
MOUNTPOINTS 所有挂载点    UUID    文件系统 UUID
```

同一个文件系统可以有多个 mount；因此新脚本优先用复数列 `MOUNTPOINTS`。

## 2. 参数族

| 参数 | 作用 |
|---|---|
| `-a, --all` | 包含空设备和 RAM disk |
| `-A, --noempty` | 排除没有 size 的设备 |
| `-b, --bytes` | SIZE 类列使用字节 |
| `-d, --nodeps` | 只显示指定设备，不展开 holder/slave |
| `-D, --discard` | 显示 discard 粒度、最大值和支持情况 |
| `-E, --dedup column` | 按列去重树，常用于多路径 WWN |
| `-e, --exclude list` | 按 major 排除顶层设备 |
| `-I, --include list` | 按 major 只包含顶层设备 |
| `-f, --fs` | 文件系统视图快捷列 |
| `-J, --json` | JSON 输出；树结构要求输出 NAME 或 `--tree` |
| `-l, --list` | 平铺列表，不输出树 |
| `-M, --merge` | 合并复杂 N:M parent，便于看 RAID/multipath |
| `-m, --perms` | owner/group/mode 快捷列 |
| `-N, --nvme` | 只显示 NVMe 设备 |
| `-n, --noheadings` | 不显示标题 |
| `-o, --output list` | 精确选择列，`+COL` 在默认列上追加 |
| `-O, --output-all` | 输出所有可用列，不适合稳定脚本 |
| `-P, --pairs` | `KEY="value"` 输出 |
| `-p, --paths` | NAME 使用完整 `/dev/...` 路径 |
| `-Q, --filter expr` | smartcols 过滤表达式，先过滤再取数 |
| `-r, --raw` | 原始输出，仍需处理转义 |
| `-S, --scsi` | 只显示 SCSI 设备 |
| `-s, --inverse` | 反向显示依赖关系 |
| `-T, --tree[=column]` | 强制树或按指定列组织树 |
| `-t, --topology` | 输出对齐、扇区、最小/最优 I/O 等拓扑列 |
| `-w, --width number` | 限制输出宽度 |
| `-x, --sort column` | 按列排序；树中仍保留 parent-child |
| `-y, --shell` | 把列名变成 shell 安全标识符 |
| `-z, --zoned` | 输出 zoned block device 信息 |
| `--list-columns` | 列出当前版本所有可输出列 |
| `--sysroot dir` | 从离线系统根读取；设备属性可能来自文本文件 |
| `--properties-by method` | 控制 udev/blkid/file 属性来源顺序 |

`--exclude/--include` 只对顶层设备应用，不能把它当成任意行过滤器；复杂选择使用 `--filter` 或 JSON 后处理。

## 3. 推荐视图

```bash
# 运维总览
lsblk -e 7 -o NAME,PATH,TYPE,SIZE,ROTA,MODEL,SERIAL,FSTYPE,FSVER,UUID,MOUNTPOINTS

# 逻辑/物理扇区与对齐
lsblk -t
lsblk -o NAME,PHY-SEC,LOG-SEC,MIN-IO,OPT-IO,ALIGNMENT

# discard/TRIM
lsblk -D

# LVM/MD 反查底层设备
lsblk -s -o NAME,TYPE,SIZE,PKNAME /dev/mapper/vg0-data

# 自动化
lsblk --json --bytes --output NAME,KNAME,TYPE,SIZE,FSTYPE,UUID,MOUNTPOINTS
```

`ROTA=0` 只表示内核报告为非旋转介质，不等于一定是本地 NVMe；云盘、SAN LUN 和 virtio 也可能如此。

## 4. 关系判读

```text
nvme0n1 (disk)
└─nvme0n1p2 (part)
  └─cryptdata (crypt)
    └─vg0-data (lvm)
```

`lsblk` 展示块层依赖，不展示 VFS 下每个进程的打开文件，也不证明设备健康。结合：

```bash
findmnt -S /dev/mapper/vg0-data
blkid /dev/mapper/vg0-data
smartctl -x /dev/nvme0
nvme smart-log /dev/nvme0
```

## 5. 常见问题

- 新盘缺少属性：先 `udevadm settle`，再检查 udev rule 和权限。
- 容器里看见设备但看不见 mount：块设备与 mount namespace 是不同视图。
- multipath 重复：用 WWN/SERIAL 核对，必要时 `-E WWN`，不能仅凭设备名删除路径。
- `FSTYPE` 为空：设备可能未格式化、签名未识别，或权限阻止 libblkid 探测。
- SIZE 与厂商容量不同：十进制/二进制单位、thin provisioning、namespace 容量都可能影响。

## 6. 安全实验与掌握标准

```bash
lsblk --list-columns
lsblk -J -o NAME,TYPE,SIZE,PKNAME,FSTYPE,MOUNTPOINTS | jq .
lsblk -s -o NAME,TYPE,PKNAME "$(findmnt -n -o SOURCE /)"
```

完成标准：能从任意 mount point 反查文件系统、逻辑卷、分区和物理设备，并明确哪些结论需要 `findmnt`、LVM、MD 或设备健康工具继续证明。

参考：[util-linux 上游仓库](https://github.com/util-linux/util-linux)与本机 `man lsblk`。
