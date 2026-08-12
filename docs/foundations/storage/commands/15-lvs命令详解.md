---
title: lvs 命令详解：Logical Volume、Thin、Snapshot 与 RAID 状态
sidebar_position: 15
description: 讲解 LVM2 lvs 报告参数、lv_attr、segment、origin/pool、thin data/meta 水位、snapshot、RAID sync/health、设备映射和故障排查。
tags: [Linux, LVM2, lvs, Thin Pool, Snapshot, RAID]
---

# `lvs` 命令详解：Logical Volume、Thin、Snapshot 与 RAID 状态

`lvs` 是 LVM 排障最重要的报告命令。一个“LV 已 active”并不代表 thin metadata 有空间、snapshot 未溢出、RAID 已同步或文件系统正常。

## 1. 推荐总览

```bash
lvs --version
lvs -a -o lv_name,vg_name,lv_attr,segtype,lv_size,origin,pool_lv,data_percent,metadata_percent,copy_percent,devices
```

`-a` 很重要：thin pool data/meta、RAID image/meta 等内部 LV 默认可能隐藏。

## 2. 参数

| 参数 | 作用 |
|---|---|
| `-a, --all` | 包含内部/隐藏 LV |
| `-o, --options LIST` | 选择列；`+devices` 常用 |
| `-O, --sort LIST` | 排序 |
| `-S, --select EXPR` | 按字段筛选 |
| `--segments` | 每个 segment 一行 |
| `--reportformat basic|json|json_std` | 机器可读输出 |
| `--units`, `--nosuffix` | 单位 |
| `--noheadings`, `--separator`, `--aligned/--unaligned` | 文本布局 |
| `--nameprefixes`, `--rows` | key-value/转置 |
| `--binary` | 布尔字段用 0/1 |
| `-v, --verbose` | 增加信息 |
| `--foreign`, `--shared` | 包含 foreign/shared VG 中的 LV |
| `--devices`, `--devicesfile` | 限定设备 |
| `--config`, `--readonly`, `--lockopt` | 配置/只读/锁控制 |

所有列：

```bash
lvs -o help
lvs --reportformat json -a -o lv_all
```

## 3. 关键字段

| 字段 | 判读 |
|---|---|
| `lv_attr` | type、permissions、allocation、fixed minor、state、open、target、health 等紧凑位 |
| `segtype` | linear/striped/thin/thin-pool/cache/raid/mirror/snapshot |
| `origin`, `pool_lv` | snapshot/thin 的来源和 pool |
| `data_percent` | thin/cache/snapshot data 使用率，语义依 segtype |
| `metadata_percent` | thin/cache metadata 使用率 |
| `copy_percent` / `sync_percent` | mirror/raid/pvmove 等进度 |
| `lv_health_status` | partial/mismatches/refresh needed 等健康摘要 |
| `devices` | segment 映射到的 PV 与 extent |
| `lv_time`, `lv_active`, `lv_open` | 创建、激活和打开状态 |

## 4. Thin pool 水位

```bash
lvs -a -o lv_name,segtype,lv_size,data_percent,metadata_percent,when_full
```

data 或 metadata 接近 100% 都可能停止写入；metadata 满尤其危险。自动扩容是否生效取决于 `thin_pool_autoextend_threshold/percent`、dmeventd 和 VG free。不能等到 100% 才处理，也不能只扩文件系统而忘记 pool。

## 5. Snapshot 与 RAID

传统 snapshot 的 COW 空间用尽会失效；thin snapshot 共享 thin pool 水位。LVM RAID 需要查看：

```bash
lvs -a -o lv_name,segtype,copy_percent,raid_mismatch_count,lv_health_status,devices
dmsetup status
```

sync 100% 仍需结合底层盘、kernel log 和 mismatch/health。不要把 LVM RAID 与 MD RAID 命令混用。

## 6. 故障证据链

```bash
findmnt -T /srv/data
lsblk -s -o NAME,TYPE,SIZE,PKNAME
lvs --reportformat json -a -o lv_name,vg_name,lv_attr,segtype,lv_size,data_percent,metadata_percent,devices
vgs -o vg_name,vg_free,vg_missing_pv_count
pvs -o pv_name,pv_uuid,pv_attr,vg_name
```

- LV inactive：查 VG/PV 可见性、system ID、lock、activation filter。
- device-mapper path 存在但 I/O error：查 partial/missing PV、thin pool、kernel target error。
- LV 空间足但 df 满：LV size 与 filesystem size 不同，扩 LV 后还需对应 filesystem grow。
- snapshot 删除/merge：会改变 origin 和 I/O，必须单独变更，不由 `lvs` 执行。

完成标准：能从 `lv_attr + segtype + data/meta + devices` 判断对象，区分 LV/VG/filesystem 三层容量。

参考：[LVM2 上游](https://gitlab.com/lvmteam/lvm2)与本机 `man lvs`。
