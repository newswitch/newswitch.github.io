---
title: iostat 命令详解：IOPS、吞吐、await、队列与利用率
sidebar_position: 9
description: 系统讲解 sysstat iostat 参数、首份累计样本、扩展设备字段、单位、分组、JSON、dm/LVM 与 NVMe 判读，并建立存储性能排障方法。
tags: [Linux, iostat, sysstat, IOPS, 延迟, 性能]
---

# `iostat` 命令详解：IOPS、吞吐、await、队列与利用率

`iostat` 从 `/proc/stat`、`/proc/diskstats` 和 sysfs 读取 CPU/块设备计数器，再按采样间隔计算速率与平均值。它观察的是块层完成统计，不直接等价于应用延迟、介质内部延迟或远端 Ceph/NFS 服务时间。

## 1. 正确采样

```bash
iostat -V
iostat -x -d -y 1 5
```

若不使用 `-y`，第一份报告通常是“自开机以来累计平均”，不能与后续 1 秒区间直接比较。最后两个位置参数是 `[interval [count]]`。

## 2. 参数族

| 参数 | 作用 |
|---|---|
| `-c` | CPU 报告 |
| `-d` | device 报告 |
| `-x` | extended device statistics |
| `-y` | 有 interval 时跳过首份累计报告 |
| `-z` | 隐藏采样期完全无活动设备 |
| `-k/-m` | KiB/s 或 MiB/s |
| `--human` | 自动选择人类可读单位 |
| `-h` | 人类友好布局，字段顺序可能改变 |
| `-N` | 显示 device-mapper 注册名称 |
| `-j ID` | 用 persistent ID（如 UUID/ID/label）显示设备 |
| `-p [dev,...|ALL]` | 设备及其分区 |
| `-g group dev...` | 把设备作为 group 汇总 |
| `-H` | 只显示 group 总计，不显示成员 |
| `-o JSON` | JSON 输出，具体 schema 随 sysstat 版本 |
| `-s` | 短设备名 |
| `-t` | 每份报告显示时间 |
| `-V` | 版本 |
| `--compact` | 紧凑输出 |
| `--dec=N` | 小数位数 |
| `--pretty` | 便于阅读的设备名布局 |
| `-f dir` | 指定持久设备名目录 |
| `-L` | 检测并避免重复 device-mapper 统计（版本相关） |

当前 sysstat 还可通过环境变量控制 S_TIME_FORMAT、颜色和单位。自动化优先 `-o JSON`，并固定版本/schema。

## 3. 扩展字段

常见字段：

| 字段 | 解释 |
|---|---|
| `r/s`, `w/s`, `d/s`, `f/s` | 每秒读、写、discard、flush 请求 |
| `rkB/s`, `wkB/s` | 吞吐 |
| `rrqm/s`, `%rrqm` | 合并的读请求及比例 |
| `r_await`, `w_await` | 请求从进入块层队列到完成的平均时间 |
| `rareq-sz`, `wareq-sz` | 平均请求大小 |
| `aqu-sz` | 平均排队/在途请求数 |
| `%util` | 设备至少有 I/O 的时间比例，现代并行设备不是容量百分比 |

不同 sysstat/kernel 会拆分 await、显示旧 `avgqu-sz/svctm` 或新增 flush/discard 字段。不要用过时公式把 `%util=100` 一律判为饱和：NVMe 可并行处理多个 queue，单个块设备也可能是多盘 RAID/网络 LUN。

## 4. 联合判断

```text
IOPS/吞吐上升 + await稳定     正常承载更大负载
IOPS不升 + await/aqu-sz上升   可能排队或下游限流
await高 + util低              间歇长尾、上层锁、远端/虚拟化需继续查
util高 + await低              高并行设备可能正常
吞吐低 + IOPS高               小块随机 I/O
吞吐高 + IOPS低               大块顺序 I/O
```

反查数据路径：

```bash
findmnt -T /srv/data
lsblk -s -o NAME,TYPE,PKNAME,SIZE
lvs -a -o +devices
iostat -x -d -y 1 10
pidstat -d 1 10
```

同一 I/O 可能同时出现在 dm、md 和物理盘行，不能相加当成业务总量。

## 5. 限制与排障

- page cache 命中不会形成对应磁盘读；应用慢不代表 iostat 必须高。
- fsync 延迟、设备 firmware GC、RAID rebuild 会造成长尾，平均 await 会稀释尖峰。
- NFS 客户端 iostat 只看本地相关块设备；使用 `nfsiostat/nfsstat`。
- Ceph RBD 需同时看客户端 krbd/librbd、网络、OSD 和后端盘。
- 容器内可能缺 `/proc/diskstats` 或设备映射，优先宿主机取证。

## 6. 完成标准

能正确跳过首份累计样本，能把 mountpoint 映射到 dm/MD/物理盘，能联合 IOPS、请求大小、await、queue 和吞吐，而不是只看 `%util`。

参考：[sysstat 官方项目](https://github.com/sysstat/sysstat)与本机 `man iostat`。
