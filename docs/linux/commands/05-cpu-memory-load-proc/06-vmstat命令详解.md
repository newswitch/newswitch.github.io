---
title: "vmstat 命令详解：运行队列、换页、IO、上下文切换与 CPU"
sidebar_label: "06. vmstat 命令详解：运行队列、换页、IO、上下文切换与 CPU"
sidebar_position: 6
description: "完整讲解 procps-ng vmstat 的全部参数、首份报告、r/b/si/so/bi/bo/in/cs/CPU 字段和生产性能排障。"
tags: [Linux, vmstat, CPU, 内存, Swap, IO, procps-ng]
---

# vmstat 命令详解：运行队列、换页、IO、上下文切换与 CPU

`vmstat` 在一行中连接 runnable/blocked 任务、内存、换页、块 IO、interrupt、context switch 与 CPU 时间，是 Linux 性能排障最重要的“方向判断”工具之一。

## 1. 命令档案与采样语法

| 项目 | 内容 |
|---|---|
| 实现 | procps-ng 4.0.6 |
| 数据源 | `/proc/stat`、`/proc/meminfo`、`/proc/vmstat`、`/proc/diskstats` 等 |
| 安全级别 | `[R]` |

```text
vmstat [option ...] [delay [count]]
```

无 delay 只输出一份；有 delay 无 count 则持续运行。第一份 rate/CPU 报告是自开机以来平均，后续才是采样区间；进程数与内存字段每次是瞬时值。

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-a, --active` | 用 active/inactive 替代默认 buff/cache 部分显示 |
| `-f, --forks` | 一次性显示自开机 task 创建总数（含 clone/thread） |
| `-m, --slabs` | 显示 slabinfo，通常需要额外权限 |
| `-n, --one-header` | 表头仅一次 |
| `-s, --stats` | 一次性显示内存与累计事件统计 |
| `-d, --disk` | 逐磁盘统计 |
| `-D, --disk-sum` | 磁盘汇总统计 |
| `-p, --partition=DEVICE` | 指定分区详细累计统计 |
| `-S, --unit=k|K|m|M` | 1000、1024、1000000、1048576 bytes；不改变 `bi/bo` |
| `-t, --timestamp` | 每行附时间戳 |
| `-w, --wide` | 宽输出，避免大内存数截断 |
| `-y, --no-first` | 省略自开机平均首份报告 |
| `-h, --help` | 帮助 |
| `-V, --version` | 版本 |

磁盘深度分析优先使用[专门的 `iostat`](../../../storage/commands/09-iostat命令详解.md)，`vmstat -d` 用于快速旁证。

## 3. 默认字段全集

| 组 | 字段 | 含义 |
|---|---|---|
| procs | `r` | 正在运行或等待 CPU 的 runnable 任务数 |
| procs | `b` | 等待 IO 完成的 blocked 任务数 |
| memory | `swpd` | 已使用 Swap |
| memory | `free` | idle memory |
| memory | `buff` | buffers |
| memory | `cache` | cache；`-a` 时变为 `inact/active` |
| swap | `si/so` | 每秒从 Swap 读入/写出内存 |
| io | `bi/bo` | 每秒从块设备读入/写出 KiB |
| system | `in` | 每秒 interrupts，含时钟中断 |
| system | `cs` | 每秒 context switches |
| cpu | `us/sy/id/wa/st/gu` | 用户、内核、idle、IO wait、steal、guest 时间占比 |

## 4. 推荐采样命令

```bash
vmstat -w -y -t 1 10
```

`-y` 去掉容易误读的历史平均，`-w` 防截断，`-t` 对齐日志。采样间隔 1 秒适合短时诊断；长期持续使用监控或 sar，避免 SSH 断开丢失证据。

## 5. 从组合而非单列判断

| 组合 | 初步假设 | 下一步 |
|---|---|---|
| `r` 持续大于可用 CPU，`id` 低 | CPU 饱和/排队 | `mpstat -P ALL`、`pidstat -u -t` |
| `b` 高、load 高、`id` 尚高 | D 状态/IO 等待 | `ps wchan`、`iostat -x`、NFS/设备日志 |
| `si/so` 持续高、PSI memory 高 | 内存压力/抖动 | `free`、`sar -B/-r/-W`、cgroup events |
| `wa` 高、`bi/bo` 活跃 | 有 outstanding IO 的 CPU idle | `iostat` 查 latency/queue/device |
| `sy`、`in/cs` 异常高 | syscall/中断/调度开销 | `pidstat -w`、mpstat interrupts、perf/eBPF |
| `st` 高 | hypervisor 抢占 vCPU | 云/虚拟化宿主指标 |

`r` 是任务数，不是 CPU 百分比；对 128 CPU 系统 `r=8` 很轻，对单 CPU 系统可能严重。`wa=0` 不证明存储无延迟，因为 CPU 可能同时有其他 runnable 工作。

## 6. 换页、缺页与缓存

`swpd` 是存量，`si/so` 是速率。已有 Swap 使用不等于正在换页；持续 `si/so` 与 latency/PSI 才说明问题。`bi/bo` 包含文件 IO 等块设备流量，不能等同 Swap。

```bash
vmstat -s
vmstat -a -w 1 5
grep -E '^(pgmajfault|pswpin|pswpout|pgscan|pgsteal)' /proc/vmstat
```

累计计数器必须做差；直接看到大数不等于当前异常。

## 7. 磁盘、分区与 slab 模式

```bash
vmstat -D
vmstat -d 1 3
vmstat -p nvme0n1p1
vmstat -m
```

磁盘/分区字段多数是累计完成数、扇区与耗时，不像默认模式那样所有字段都是速率。`-m` 读取 `/proc/slabinfo`，普通用户可能无权限；交互排序和内存口径用 `slabtop` 更方便。

## 8. 容器和观察开销

容器的 procfs/cgroup namespace 可能使进程视图与 CPU/内存/IO 汇总范围不同。`vmstat` 不天然给出“该 Pod 的 r/wa”；应配合 cgroup `cpu.stat`、memory/io pressure、Kubernetes 指标。

1 秒采样开销通常较低，但数百节点同时用远程脚本高频采集也会造成噪声。保存版本、主机、时区、采样 interval/count。

## 9. 常见误判、退出状态与实验

| 误判 | 修正 |
|---|---|
| 第一行就是当前 1 秒 | 第一份多数 rate 是自开机平均，用 `-y` |
| `b` 只代表磁盘 | 也可能 NFS、设备、驱动或其他内核等待 |
| `cs` 高必然异常 | 与 workload、CPU 数和基线比较 |
| `swpd` 高就清 Swap | 先看 `si/so`、可用内存和业务延迟 |

成功为 `0`，参数/读取错误为非 `0`。实验：制造短 CPU、文件 IO 与受控内存压力，分别观察字段组合；比较首份与后续报告；验证 `-S` 不改变 `bi/bo`。

掌握标准：能解释全部参数与默认字段，能从组合判断 CPU、内存、IO、虚拟化方向，并能指出首份报告、累计/瞬时/速率口径。

## 10. 官方参考 {/* #官方参考 */}

- [procps-ng vmstat(8)](https://man7.org/linux/man-pages/man8/vmstat.8.html)
- [Linux procfs 文档](https://docs.kernel.org/filesystems/proc.html)
- [Linux `/proc/stat`](https://docs.kernel.org/filesystems/proc.html#miscellaneous-kernel-statistics-in-proc-stat)

上一篇：[`free` 命令详解](./05-free命令详解.md)

下一篇：[`mpstat` 命令详解](./07-mpstat命令详解.md)
