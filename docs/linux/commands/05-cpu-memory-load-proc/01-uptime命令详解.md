---
title: "uptime 命令详解：运行时间、负载平均与容器时间边界"
sidebar_label: "01. uptime 命令详解：运行时间、负载平均与容器时间边界"
sidebar_position: 1
description: "完整讲解 procps-ng uptime 的参数、load average、启动时间、utmp、time namespace 与容器排障边界。"
tags: [Linux, uptime, load average, procps-ng, 容器]
---

# uptime 命令详解：运行时间、负载平均与容器时间边界

`uptime` 用一行展示当前时间、运行时长、登录用户数和 1/5/15 分钟 load average。它适合建立现场基线，但不能单独证明 CPU 饱和。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 常见实现 | procps-ng 4.0.6；GNU coreutils 也提供同名实现 |
| 数据源 | `/proc/uptime`、`/proc/loadavg`、`/var/run/utmp` |
| 安全级别 | `[R]` |

```text
uptime [option ...]
```

```bash
type -a uptime
uptime --version
uptime --help
```

本文以 procps-ng 为基线。同名实现的参数不同，脚本发布前必须在目标发行版核对。

## 2. 全部参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-c` | `--container` | 显示容器/time namespace 视角的 uptime |
| `-p` | `--pretty` | 只用易读文本显示运行时长 |
| `-r` | `--raw` | 当前时间和 uptime 以秒数输出 |
| `-s` | `--since` | 显示推算的启动时间 `YYYY-MM-DD HH:MM:SS` |
| `-h` | `--help` | 帮助 |
| `-V` | `--version` | 版本 |

环境变量 `PROCPS_CONTAINER` 被设置时，行为等同 `--container`。

## 3. 默认输出如何读

```text
14:30:12 up 10 days,  3:20,  2 users,  load average: 2.40, 1.80, 1.20
```

登录用户数来自 utmp，不代表当前 SSH TCP 连接数，也不代表业务用户数。load 统计可运行任务与不可中断睡眠任务的指数衰减平均，三个数字没有按 CPU 数归一化。

```bash
uptime
nproc
vmstat -w -y 1 5
```

若 4 个可用 CPU 上 load 长期为 8，同时 `r` 高、CPU idle 低，CPU 排队假设较强；若 CPU idle 高而 `b`、D 状态高，应转向存储/NFS/驱动等待。

## 4. 运行时间、启动时间与墙钟

```bash
uptime -p
uptime -s
uptime -r
cat /proc/uptime
```

`/proc/uptime` 第一项是系统运行秒数，第二项是各 CPU 累计 idle 秒数，可能远大于第一项。`uptime -s` 由运行时间与墙钟推算；NTP 校时、挂起/恢复、虚拟化和版本差异会使它不适合作为严格审计时间。启动日志用 `journalctl --list-boots` 等证据交叉验证。

## 5. 容器边界

time namespace 可以为容器提供不同的 monotonic/boottime offset；新版 procps-ng 的 `--container` 尝试显示该视角。并非所有运行时、内核和发行版都支持或配置它。

容器内 load 往往仍来自共享内核视图，不能自然归因到单个 Pod；CPU 配额则可能很小。必须结合 `nproc`、cgroup `cpu.stat`、PSI 和平台监控。

## 6. 脚本与解析

默认输出受 locale 影响，不要用固定空格和英文单词解析。需要机器数据时直接读取 `/proc/uptime`、`/proc/loadavg`，或使用监控 exporter；必要时固定 `LC_ALL=C`。

```bash
LC_ALL=C uptime
read -r up_s idle_s < /proc/uptime
printf 'uptime_seconds=%s\n' "$up_s"
```

## 7. 常见误判

| 现象 | 正确处理 |
|---|---|
| load 2 就认为严重 | 先确认可用 CPU、单核热点和延迟目标 |
| load 高就等于 CPU 高 | 检查 `R` 与 `D`、`r/b`、CPU idle |
| 用户数是 0 就没人访问 | utmp 只记录登录会话 |
| 容器 uptime 等于 Pod 年龄 | 看 runtime/Kubernetes 创建与启动时间 |
| 1/5/15 是三个简单窗口平均 | 它们是指数衰减平均 |

## 8. 退出状态、实验与掌握标准

成功为 `0`，读取接口或参数失败为非 `0`。实验：比较默认、pretty、since、raw；制造一个短 CPU 热点观察三个 load 数字衰减；比较宿主机与容器的 uptime、load、CPU 配额。

掌握标准：能解释每个字段、全部参数、load 的任务状态与非归一化特性，并能说明为何 `uptime` 只是排障入口。

## 9. 官方参考 {/* #官方参考 */}

- [procps-ng uptime(1)](https://man7.org/linux/man-pages/man1/uptime.1.html)
- [Linux proc_loadavg(5)](https://man7.org/linux/man-pages/man5/proc_loadavg.5.html)
- [Linux time_namespaces(7)](https://man7.org/linux/man-pages/man7/time_namespaces.7.html)

上一篇：[CPU、内存、负载与 procfs 命令导读](./00-CPU内存负载与procfs命令导读.md)

下一篇：[`nproc` 命令详解](./02-nproc命令详解.md)
