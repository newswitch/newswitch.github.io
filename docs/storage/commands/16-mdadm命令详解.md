---
title: mdadm 命令详解：Linux MD RAID 查询、组装、监控与恢复边界
sidebar_position: 16
description: 讲解 mdadm 的七种模式、核心参数、superblock、阵列状态、成员管理、assemble/create/build/grow/manage/monitor、bitmap、reshape 和安全恢复流程。
tags: [Linux, mdadm, RAID, Linux MD, 数据恢复]
---

# `mdadm` 命令详解：Linux MD RAID 查询、组装、监控与恢复边界

`mdadm` 管理 Linux MD 软件 RAID。它同时包含完全只读的查询和会覆盖 superblock、改变阵列布局甚至销毁数据的操作，必须先识别“模式”，再谈参数。

## 1. 状态与配置

```bash
mdadm --version
cat /proc/mdstat
mdadm --detail /dev/md0
mdadm --examine /dev/sdX1
```

```text
member devices + MD superblock → /dev/mdX → filesystem/LVM
```

`--detail` 看已运行阵列，`--examine` 看成员设备上的 metadata。两者都要保存，尤其在无法自动 assemble 时。

## 2. 七类模式

| 模式 | 入口 | 用途/风险 |
|---|---|---|
| Assemble | `--assemble/-A` | 按现有 superblock 组装 |
| Build | `--build/-B` | 无 metadata 的旧式阵列，高风险 |
| Create | `--create/-C` | 创建新阵列并写 metadata，`[D]` |
| Manage | `--manage` | fail/remove/add/replace 成员 |
| Misc | `--query/-Q`, `--detail/-D`, `--examine/-E`, `--zero-superblock` | 查询或 metadata 操作 |
| Follow/Monitor | `--monitor/-F` | 监控状态和通知 |
| Grow | `--grow/-G` | 改设备数、大小、level/layout/chunk，reshape 高风险 |

同一个参数在不同模式下是否有效不同。任何恢复操作前运行 `mdadm --help-options`、`--help --assemble` 等本机帮助。

## 3. 查询与输出

```bash
mdadm --query /dev/md0
mdadm --detail --export /dev/md0
mdadm --examine --scan
mdadm --detail --scan
```

关键字段：RAID Level、Array Size、Used Dev Size、Raid Devices、Total/Active/Working/Failed/Spare Devices、State、Consistency Policy、Rebuild Status、Events、UUID、Role、Update Time。

`[UU_U]` 中 `_` 表示缺失成员；recovery/resync/reshape 的 `finish` 只是估计。

## 4. Create/Assemble 核心参数

| 参数 | 作用 |
|---|---|
| `--level=LEVEL` | raid0/1/4/5/6/10/linear 等 |
| `--raid-devices=N` | active 成员数 |
| `--spare-devices=N` | spare 数 |
| `--metadata=VERSION` | 0.90/1.0/1.1/1.2/external 等 |
| `--chunk=SIZE` | stripe chunk |
| `--layout=LAYOUT` | RAID5/6/10 layout |
| `--bitmap=FILE|internal|none` | write-intent bitmap |
| `--consistency-policy=POLICY` | resync/bitmap/journal/ppl 等，依 level/kernel |
| `--uuid=UUID`, `--name=NAME` | 阵列身份 |
| `--homehost=HOST` | homehost 身份策略 |
| `--run/-R` | 立即运行 |
| `--readonly/-o` | 只读启动 |
| `--force/-f` | 接受风险状态；不能作为常规修复 |
| `--scan/-s`, `--config=FILE` | 扫描和配置文件 |
| `--update=TYPE` | assemble 时更新 metadata 字段，需精确场景 |

`--assume-clean` 会跳过初始同步；只有数据布局已知正确的迁移/恢复场景才可能使用。错误使用会让阵列静默包含不一致数据。

## 5. Manage 成员

```bash
mdadm /dev/md0 --fail /dev/sdX1
mdadm /dev/md0 --remove /dev/sdX1
mdadm /dev/md0 --add /dev/sdY1
```

这些是示意语法，不是故障盘自动处理模板。先按 serial/WWN/槽位确认设备，检查阵列冗余、是否还有 read error、备份和 rebuild 压力。误 fail/remove 正常成员可能让阵列不可恢复。

其他 manage 参数包括 `--re-add`、`--replace`、`--with`、`--write-mostly/--readwrite`，支持取决于 level/metadata/kernel。

## 6. Grow 与 reshape

```text
--size         改每成员使用容量
--raid-devices 改成员数
--level        改 RAID level
--layout       改布局
--chunk        改 chunk
--backup-file  为关键 reshape 保存临界区数据
```

reshape 期间断电、盘故障或 backup file 丢失可能造成不可恢复。backup file 不能放在正在 reshape 的同一阵列。完成 MD grow 后，还可能要依次扩 PV/LV/filesystem。

## 7. Monitor

```bash
mdadm --monitor --scan --oneshot
systemctl status mdmonitor --no-pager
```

`--mail`、`--program`、`--delay`、`--daemonise`、`--pid-file`、`--syslog` 控制通知。监控可用必须做告警演练，不能只看进程 active。

## 8. 安全恢复流程

1. 停止进一步写入，保存 `/proc/mdstat`、detail、每个成员 examine。
2. 按 serial/WWN/槽位绘制成员、role、event count、size。
3. 保护原盘，必要时先镜像不稳定成员。
4. 判断是正常 degraded assemble、成员替换，还是 metadata/data recovery。
5. 只读 assemble 验证优先；`--force`、`--create --assume-clean`、`--zero-superblock` 必须有专家审查。
6. 阵列起来后验证文件系统和业务数据，不能因 `/proc/mdstat` 为 `[UU]` 就宣布恢复成功。

## 9. 常见误区

- 对旧阵列执行 create 代替 assemble；create 会写 metadata。
- 只按 `/dev/sdX` 认盘，重启后名称变化。
- RAID 是备份；它不防误删、逻辑损坏、勒索和多盘相关故障。
- rebuild 时跑满 fio，增加剩余盘失败概率。
- 直接 zero-superblock“清理旧盘”，却清错了在线成员。

完成标准：能区分七种模式，先收集 event/role/UUID/serial，再决定组装或成员操作；任何 force/create/zero/grow 都有可复核变更单。

参考：[kernel.org mdadm 发布与源码](https://www.kernel.org/pub/linux/utils/raid/mdadm/)及[Linux MD 文档](https://docs.kernel.org/admin-guide/md.html)。
