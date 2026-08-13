---
title: top 命令详解：CPU、内存、线程、排序与批处理快照
sidebar_position: 4
description: 完整讲解 procps-ng top 的命令行参数、交互命令、CPU/内存/进程字段、线程模式、批处理、过滤和生产排障边界。
tags: [Linux, top, CPU, 内存, 线程, procps-ng]
---

# `top` 命令详解：CPU、内存、线程、排序与批处理快照

`top` 周期读取 procfs，将系统汇总和任务差分放在同一屏。它特别适合交互式发现热点；长期监控、稳定机器解析和历史回看应使用 sysstat/监控系统。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | procps-ng 4.0.6 |
| 配置 | `~/.config/procps/toprc` 或 `~/.toprc`、`/etc/toprc` |
| 安全级别 | 观察 `[R]`；`k/r/W` 会发信号、调优先级、写配置 `[W/D]` |

```text
top [option ...]
```

先按 `h` 或 `?` 查看当前版本交互帮助，`q` 退出。

## 2. 全部命令行参数

| 参数 | 含义 |
|---|---|
| `-A, --apply-defaults` | 仅用构建默认与 `/etc/toprc`；必须作为唯一选项 |
| `-b, --batch` | 非交互批处理模式 |
| `-c, --cmdline-toggle` | 反转配置中的命令名/完整命令行状态 |
| `-d, --delay=SECONDS` | 刷新间隔，可含小数，不能为负 |
| `-E, --scale-summary-mem=k|m|g|t|p|e` | 固定汇总区内存单位 |
| `-e, --scale-task-mem=k|m|g|t|p` | 固定任务区内存单位 |
| `-H, --threads-show` | 显示单个线程，而非进程聚合 |
| `-h, --help` | 帮助 |
| `-i, --idle-toggle` | 反转是否显示本周期无 CPU 的任务 |
| `-n, --iterations=N` | 最多输出 N 帧 |
| `-O, --list-fields` | 列出可供 `-o` 使用的字段名 |
| `-o, --sort-override=FIELD` | 覆盖排序字段；`+` 高到低，`-` 低到高 |
| `-p, --pid=PIDLIST` | 只监控指定 PID，最多 20 个；与 `-u/-U` 互斥 |
| `-S, --accum-time-toggle` | 反转累计已回收子进程 CPU 时间模式 |
| `-s, --secure-mode` | 强制 secure mode，限制危险交互操作 |
| `-u, --filter-only-euser=USER` | 按 effective UID 筛选，可用 `!` 反选 |
| `-U, --filter-any-user=USER` | 按 real/effective/saved/filesystem UID 筛选 |
| `-V, --version` | 版本 |
| `-w, --width[=COLUMNS]` | 控制输出宽度，最大 512 列 |
| `-1, --single-cpu-toggle` | 反转汇总 CPU/逐 CPU 显示 |

长参数的必选值对短参数也必选。个人配置会改变启动状态，故障采集脚本应显式写 `-b -n -d -o -w` 等关键参数。

## 3. 汇总区：先看系统而非 PID

```text
load → tasks states → CPU states → physical memory → swap
```

CPU 字段：`us` 用户、`sy` 内核、`ni` nice 用户、`id` idle、`wa` 有未完成 IO 时的 idle、`hi` 硬中断、`si` 软中断、`st` 被 hypervisor steal。`wa` 不是“CPU 忙着做 IO”，也不能单独代表磁盘利用率。

任务状态：running 对应 `R`，d-sleep 对应 `D`，stopped 对应 `T/t`，zombie 对应 `Z`。load 高而 idle 高时，重点看 D 状态与 IO/内核等待。

内存 `used` 近似 `MemTotal - MemAvailable`；`avail` 是无需明显 swapping 即可给新应用的估算。不要把 `buff/cache` 全部视作浪费。

## 4. 任务区关键字段

| 字段 | 含义与边界 |
|---|---|
| `%CPU` | 最近刷新区间 CPU 占比；多线程进程可超过 100% |
| `TIME+` | 累计 CPU 时间，不是墙钟运行时长 |
| `VIRT` | 已用或保留的全部虚拟地址空间 |
| `RES` | 当前驻留物理内存，含共享页 |
| `SHR` | RES 中潜在/实际共享部分，不能简单相减得私有内存 |
| `S` | 任务状态 |
| `P` | 最近使用的 CPU，不代表固定 affinity |
| `nTH` | 线程数 |
| `WCHAN` | 睡眠时等待的内核函数/符号，权限可能隐藏 |

按 `f` 进入字段管理，可显示/隐藏、排序和移动字段。`top -O` 获取本机字段名；字段会随内核和 procps-ng 版本变化。

## 5. 常用交互命令

| 类别 | 按键 |
|---|---|
| 帮助/退出/刷新 | `h/?`、`q`、`Space/Enter` |
| CPU/NUMA 汇总 | `1` 逐 CPU、`2` NUMA、`3` node、`4` 多 CPU 每行、`5` P/E core、`!` 合并 CPU、`^` core/CPU |
| 汇总显示 | `l` load、`t` CPU 图、`m` 内存图、`E` 汇总内存单位 |
| 任务内容 | `H` 线程、`c` 命令行、`f` 字段、`V` forest、`S` 累计、`u/U` 用户、`O/o` 过滤 |
| 排序 | `P` CPU、`M` 内存、`T` 时间、`N` PID、`R` 反向、`<`/`>` 移动排序字段 |
| 数量/闲置 | `n/#` 最大任务、`i` 是否显示闲置任务 |
| 搜索 | `L` 定位、`&` 下一个匹配 |
| 状态变更 | `k` 发信号、`r` renice、`W` 写配置 |

交互键非常多且有窗口/模式上下文，上表覆盖排障主线；当前实现的完整清单以 `h/?` 和官方手册第 4、5 节为准。执行 `k/r` 前必须确认 PID、启动时间、namespace 和服务管理器。

## 6. 推荐用法

```bash
# 交互式：逐 CPU、显示线程后按 CPU 排序
top
# 依次按：1 H P

# 固定 PID，5 次采样
top -b -H -p 1234 -d 1 -n 5 -w 200

# 批处理按 RSS 排序；字段名先用 top -O 核对
LC_ALL=C top -b -n 2 -d 1 -o RES -w 200
```

第一帧某些 CPU 值覆盖自开机以来，第二帧开始才是指定间隔；因此采证通常至少 `-n 2`。批处理文本仍受版本、locale、配置和终端宽度影响，自动化优先 `pidstat -o JSON` 或指标 API。

## 7. Irix/Solaris CPU 口径

默认 Irix mode 下，一个线程占满一个逻辑 CPU 可显示约 100%，多线程进程可超过 100%。按 `I` 切到 Solaris mode 后，任务 CPU 除以系统 CPU 数。报告必须写清口径，否则同一进程会得到不同百分比。

## 8. 容器与权限边界

PID namespace 决定可见任务，procfs 挂载与 hidepid/LSM 决定字段权限；CPU 和内存汇总可能仍反映宿主机，而任务列表只反映容器。容器限制应另外读取 cgroup。

普通用户不能观察所有敏感字段，也不能随意 renice/kill 他人任务。命令行可能含 token/密码，采集 `COMMAND` 前先做脱敏和访问控制。

## 9. 常见排障模式

| 现象 | 下一步 |
|---|---|
| `us` 高 | 按 `P`，再 `H` 找热线程，进入 profiler |
| `sy/si/hi` 高 | 看 pidstat、mpstat interrupts、网络/IO、perf/eBPF |
| `st` 高 | 查虚拟化宿主争用与云平台指标 |
| load 高但 `id` 高 | 查 D 状态、`vmstat b`、存储/NFS/驱动 |
| RES 增长 | 用 `pmap -X/-XX`、应用 heap profiler、cgroup 指标 |
| zombie 增长 | 找父进程未 wait；不能 kill zombie |

## 10. 退出状态、实验与掌握标准

正常退出通常为 `0`，参数/读取错误为非 `0`；信号终止依 Shell 规则表示。实验：比较一/多线程 `%CPU`、Irix/Solaris、进程/线程视图、第一/第二帧、RES/VIRT/SHR、PID namespace。

掌握标准：能列出全部 CLI 参数，解释汇总与关键任务字段，安全使用过滤/线程/排序/批处理，并知道何时切换到 pidstat、sar、perf 或应用 profiler。

## 官方参考

- [procps-ng top(1)](https://man7.org/linux/man-pages/man1/top.1.html)
- [Linux proc_pid_stat(5)](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html)
- [Linux proc_pid_status(5)](https://man7.org/linux/man-pages/man5/proc_pid_status.5.html)

上一篇：[`lscpu` 命令详解](./03-lscpu命令详解.md)

下一篇：[`free` 命令详解](./05-free命令详解.md)
