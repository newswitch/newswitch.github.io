---
title: vgs 命令详解：Volume Group 容量、属性与元数据诊断
sidebar_position: 14
description: 讲解 LVM2 vgs 的 VG/extent 模型、报告参数、属性位、容量、metadata、cluster/shared/foreign 状态和生产排障。
tags: [Linux, LVM2, vgs, Volume Group, device-mapper]
---

# `vgs` 命令详解：Volume Group 容量、属性与元数据诊断

`vgs` 报告 Volume Group。VG 把一个或多个 PV 的 Physical Extent 汇总，再分配给 LV。它回答“卷组还有多少未分配 extent、由几块 PV 组成、元数据和访问属性是否正常”。

## 1. 基础查询

```bash
vgs --version
vgs
vgs -o vg_name,vg_uuid,vg_attr,vg_size,vg_free,pv_count,lv_count
```

## 2. 参数

`vgs` 与其他 LVM report command 共享统一报告框架：

| 参数 | 作用 |
|---|---|
| `-o, --options LIST` | 选择/增删列 |
| `-O, --sort LIST` | 排序 |
| `-S, --select EXPR` | 字段条件选择 |
| `--reportformat basic|json|json_std` | 输出格式 |
| `--units`, `--nosuffix` | 单位控制 |
| `--noheadings`, `--separator`, `--aligned/--unaligned` | 文本格式 |
| `--nameprefixes`, `--rows` | key 前缀/转置 |
| `-v, --verbose` | 详细信息 |
| `--foreign`, `--shared` | 包含 foreign/shared VG |
| `--devices`, `--devicesfile` | 限定 LVM 可见设备 |
| `--config` | 临时覆盖配置 |
| `--readonly` | 只读模式 |
| `--lockopt` | lvmlockd 锁选项，集群环境慎用 |

```bash
vgs -o help
vgs --reportformat json -o vg_all
```

## 3. 字段和容量边界

| 字段 | 说明 |
|---|---|
| `vg_attr` | permissions、resizable、exported、partial、clustered/shared 等属性位 |
| `vg_size`, `vg_free` | VG 总 extent 容量和未分配容量 |
| `vg_extent_size/count/free_count` | PE 粒度和数量 |
| `pv_count`, `lv_count`, `snap_count` | 对象数量 |
| `vg_mda_count/free` | metadata area 数量与剩余 |
| `vg_missing_pv_count` | 缺失 PV 数 |
| `vg_lock_type`, `vg_lock_args` | shared VG 锁信息 |
| `vg_systemid` | system ID ownership |

`VFree` 不能代表 thin pool free、文件系统 free 或 snapshot 可增长空间：

```bash
vgs -o vg_name,vg_size,vg_free
lvs -a -o lv_name,segtype,lv_size,data_percent,metadata_percent
df -hT
```

## 4. 排障

```bash
vgs --reportformat json \
  -o vg_name,vg_uuid,vg_attr,vg_size,vg_free,pv_count,lv_count,vg_missing_pv_count
vgs -S 'vg_missing_pv_count>0' -o +vg_uuid
```

- partial VG：先找 missing PV/底层 path，不要直接 vgreduce --removemissing。
- VG 不可见：device filter/devices file、system ID、foreign/shared 和锁服务。
- metadata space 少：检查 metadata copies、备份和历史变更，不要继续堆叠复杂操作。
- lock failed：集群 VG 需检查 lvmlockd/sanlock/dlm，绕过锁可能破坏共享元数据。

LVM 默认会在 `/etc/lvm/backup` 和 `/etc/lvm/archive` 保存文本元数据历史，但它不是数据备份。

完成标准：能区分 VG free、thin free 和 filesystem free，能解释 VG attribute/partial/shared，并先修复底层设备和锁所有权。

参考：[LVM2 上游](https://gitlab.com/lvmteam/lvm2)与本机 `man vgs`。
