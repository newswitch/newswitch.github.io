---
title: renice 命令详解：调整运行中进程、进程组与用户的 niceness
sidebar_position: 15
description: 完整讲解 util-linux renice 参数、绝对/相对优先级、POSIXLY_CORRECT 差异、PID/PGID/用户作用域、权限、线程与 cgroup 边界。
tags: [Linux, renice, CPU调度, niceness, util-linux]
---

# `renice` 命令详解：调整运行中进程、进程组与用户的 niceness

`renice` 修改已经运行任务的 niceness。默认目标是 PID，亦可选择 PGID 或用户；按用户操作会影响该用户当前的广泛进程集合，生产环境风险很高。

## 1. 语法与完整参数

```text
renice [-n|--priority|--relative] VALUE [-g|-p|-u] identifier...
```

| 参数 | 作用 |
|---|---|
| `-n VALUE` | 默认设置绝对 niceness；`POSIXLY_CORRECT` 存在时改为相对 delta，存在环境歧义 |
| `--priority VALUE` | 明确设置绝对 niceness，推荐 |
| `--relative DELTA` | 明确对现值增减 delta，推荐 |
| `-g`, `--pgrp` | 后续 identifier 按 PGID 解释 |
| `-p`, `--pid` | 后续按 PID 解释，默认 |
| `-u`, `--user` | 后续按 UID/用户名解释 |
| `-h`, `--help` | 显示帮助 |
| `-V`, `--version` | 显示版本 |

目标类型选项可在参数序列中切换，阅读性和安全性上建议一次命令只用一种目标类型。

## 2. 绝对与相对模式

```bash
renice --priority 10 --pid "$pid"
renice --relative 5 --pid "$pid"
renice --priority 5 --pgrp "$pgid"
```

不要在自动化中用 `-n`，因为 `POSIXLY_CORRECT` 会改变绝对/相对语义。修改前后显式读取：

```bash
ps -o pid,tid,cls,pri,ni,comm -L -p "$pid"
```

## 3. 权限、线程和作用域

普通用户只能操作自己拥有的任务，通常只能增加 niceness（降低权重），除非 RLIMIT_NICE 允许；root/CAP_SYS_NICE 可设 `-20..19`。

Linux 内核 niceness 实际是 per-thread 属性，而 POSIX 从进程概念描述；工具按 PID 操作时不要假设所有线程必然一起变化。需要一致性时枚举 TID或由应用/服务管理器配置。

按 `--user` 会处理该用户当前所有可见进程；扫描期间新进程、权限失败会导致部分状态。按 PGID 适合 Shell pipeline，但要先验证组成员。

## 4. cgroup 与性能边界

niceness 只在可运行任务竞争普通 CPU 时影响相对权重。cgroup CPU weight/max、cpuset、实时策略、NUMA、I/O 与 GPU 瓶颈可使效果很小。性能优化前先证明 run queue 竞争和目标调度类。

## 5. 退出状态、实验与掌握标准

成功返回 `0`，无权限、目标消失、值非法或部分目标失败返回非零；扫描与修改不是事务，需逐目标验证。

实验：覆盖绝对/相对、POSIXLY_CORRECT、PID/PGID/user、普通用户权限、线程差异和 cgroup 竞争。掌握标准是能列出全部参数，避免 `-n` 环境歧义，并说明 renice 不能替代 CPU quota/affinity/实时调度。

## 官方参考

- [util-linux：renice(1)](https://man7.org/linux/man-pages/man1/renice.1.html)
- [Linux getpriority(2)](https://man7.org/linux/man-pages/man2/getpriority.2.html)

上一篇：[`nice` 命令详解](./14-nice命令详解.md)

下一篇：[`nohup` 命令详解](./16-nohup命令详解.md)
