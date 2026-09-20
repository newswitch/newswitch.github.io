---
title: "Device Mapper、LVM、RAID 与 Multipath：块设备为什么会层层映射"
sidebar_label: "07. Device Mapper、LVM、RAID 与 Multipath"
sidebar_position: 7
description: "解释 Device Mapper target、LVM、dm-crypt、thin、MD RAID、multipath 的映射路径与故障边界。"
tags: [Linux, Device Mapper, LVM, RAID, Multipath]
---

# Device Mapper、LVM、RAID 与 Multipath：块设备为什么会层层映射

一个文件系统设备可能不是直接物理盘，而是多层逻辑映射。每一层都可能拆分、合并、重定向请求，并拥有独立容量、错误和恢复状态。

## 1. Device Mapper

Device Mapper 根据映射表把逻辑扇区范围交给 target：

```text
/dev/mapper/app-data
→ dm target table
→ linear / crypt / thin / snapshot / multipath 等
→ 一个或多个下层块设备
```

它是 LVM、dm-crypt、部分 multipath/thin/snapshot 能力的基础，不等于某一个具体产品。

## 2. LVM

```text
Physical Volume
→ Volume Group（Extent 池）
→ Logical Volume
→ 文件系统或裸块应用
```

LVM 提供逻辑容量管理，不天然提供数据冗余；是否镜像/RAID 取决于 LV 类型。扩容 LV 后还需扩文件系统；缩容风险更高且并非所有文件系统支持在线缩小。

## 3. MD RAID

MD 在 Linux 内核中把多个块设备组织成 RAID。不同级别在容量、容错、读写放大和重建风险上不同。降级可用不等于健康；重建时第二故障和不可恢复读错误风险增加。

## 4. Multipath

Multipath 把同一存储 LUN 的多条主机—交换—Target 路径组合成一个逻辑设备，负责路径选择和故障切换。多路径不是多副本：不同路径通常通向同一后端数据。

```text
dm-multipath device
├── path A：HBA0 → fabric A → controller A
└── path B：HBA1 → fabric B → controller B
```

路径抖动、错误重试和 queue-if-no-path 可让应用长时间 D 状态而非立即报错。配置必须与业务超时和存储策略匹配。

## 5. Thin Provisioning

Thin LV/云盘可暴露大逻辑容量，实际按写入分配后端块。数据池或 metadata pool 满会导致 IO 失败或只读/暂停，文件系统 `df` 可能仍显示空间。

```bash
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS
dmsetup ls --tree
pvs; vgs; lvs -a -o +devices,data_percent,metadata_percent
cat /proc/mdstat
multipath -ll 2>/dev/null
```

命令应对正确环境执行，裸设备和映射关系变更具有数据风险。

## 6. 一次 IO 如何展开

```text
ext4 on LV
→ dm-crypt 加密
→ dm-thin 映射物理块
→ multipath 选择路径
→ SCSI request
→ HBA
→ SAN LUN
```

任何一层的 100% 利用率、超时或容量不足都可能向上表现为同一个 `write latency`。排查要先画设备树，再从上到下对齐主次设备号和时间线。

## 7. 练习与答案

**问题：Multipath 有两条 active path，是否等于数据有两份？**

答案：不是。它通常是同一 LUN 的两条访问路径，解决路径冗余；数据副本由存储阵列或其他复制机制提供。

**问题：文件系统 df 还有 40%，为什么写入可能失败？**

答案：下层 thin data/metadata、快照预留、阵列池、配额或物理设备可能已满。

下一篇：[IOPS、吞吐、延迟与 iostat](./08-IOPS吞吐延迟与iostat.md)
