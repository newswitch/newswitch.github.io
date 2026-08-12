---
title: pvs 命令详解：Physical Volume、设备归属与机器可读报告
sidebar_position: 13
description: 讲解 LVM2 pvs 的 PV/VG/PE 模型、报告字段与通用参数、JSON、选择表达式、devices file、多路径重复设备和缺失 PV 排障。
tags: [Linux, LVM2, pvs, Physical Volume, device-mapper]
---

# `pvs` 命令详解：Physical Volume、设备归属与机器可读报告

`pvs` 是 LVM2 的只读报告命令，用一行表示一个 Physical Volume。PV 是 LVM 写入元数据并划分 Physical Extent 的块设备，底层可能是分区、MD、multipath LUN、加密 mapper 或整盘。

## 1. 模型

```text
block device → PV → VG → LV → filesystem/mount
                       PE ↔ LE mapping
```

```bash
pvs --version
pvs
pvs -o pv_name,pv_uuid,vg_name,pv_size,pv_free,pv_attr
```

## 2. 报告参数

| 参数 | 作用 |
|---|---|
| `-a, --all` | 包含通常被忽略的设备/内部 PV 视图 |
| `-o, --options LIST` | 选择列；`+COL` 追加默认列，`-COL` 删除 |
| `-O, --sort LIST` | 按列排序，`-field` 降序 |
| `-S, --select EXPR` | 按字段表达式筛选 |
| `--reportformat basic|json|json_std` | 机器可读格式，以本机版本为准 |
| `--units h|b|k|m|g|t|...` | 单位 |
| `--nosuffix` | 不显示单位后缀 |
| `--noheadings` | 无标题 |
| `--separator STRING` | 列分隔符 |
| `--aligned/--unaligned` | 对齐控制 |
| `--nameprefixes` | `LVM2_PV_NAME=...` 形式 |
| `--rows` | 列转行 |
| `-v, --verbose` | 增加信息，可重复 |
| `--segments` | 按 PV segment 输出 |
| `--config STRING` | 临时覆盖 lvm.conf，自动化慎用 |
| `--devices LIST` | 本次命令限定设备 |
| `--devicesfile FILE` | 使用 devices file |
| `--foreign/--shared` | 包含 foreign/shared VG 相关 PV |
| `--readonly` | 避免可能的元数据写入路径 |
| `--ignorelockingfailure` | 锁失败仍继续，结果可能不完整 |

LVM2 每个发行版列集合不同：

```bash
pvs -o help
pvs --reportformat json -o pv_all
```

## 3. 关键字段

| 字段 | 意义 |
|---|---|
| `pv_name`, `pv_uuid` | 设备路径与稳定 PV identity |
| `vg_name`, `vg_uuid` | 所属 VG |
| `pv_size`, `pv_free` | 可用于 extent 的容量/空闲 |
| `pv_used` | 已映射到 LV 的容量 |
| `pv_attr` | allocatable/exported/missing 等紧凑属性 |
| `pv_mda_count/used_count` | metadata area 数量与使用情况 |
| `dev_size` | 底层 device size，可能与 PV size 不同 |
| `pe_start`, `pv_pe_count` | data area 起点和 PE 数量 |

PV free 不等于文件系统 free，也不等于 thin pool 可用空间。

## 4. 自动化和排障

```bash
pvs --reportformat json \
  -o pv_name,pv_uuid,vg_name,pv_size,pv_free,pv_attr,devices

pvs -S 'pv_missing=1' -o +pv_uuid
pvs --segments -o pv_name,pvseg_start,pvseg_size,lv_name,segtype
```

常见故障：

- duplicate PV：克隆盘、multipath 未正确聚合或旧签名；先按 WWID/PV UUID 核对，不能直接 pvremove。
- PV missing/unknown device：查 udev、multipath、MD、SAN path、devices file 和 kernel log。
- device excluded by filter：比较 `lvmconfig --type full devices` 和 `/etc/lvm/devices/system.devices`。
- PV size mismatch：底层 LUN/分区扩容后可能需 `pvresize`，但先核对全路径容量。

```bash
lsblk -s -o NAME,TYPE,SIZE,WWN,SERIAL
pvs -o +devices,pv_uuid,pv_mda_count,pv_mda_used_count
```

完成标准：能从 mount/LV 反查 PV 和物理路径，能解释 duplicate/missing/filter，而不执行 `pvremove/pvcreate` 覆盖元数据。

参考：[LVM2 上游](https://gitlab.com/lvmteam/lvm2)与本机 `man pvs`。
