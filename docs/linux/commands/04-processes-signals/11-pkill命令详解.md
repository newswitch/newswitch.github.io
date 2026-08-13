---
title: pkill 命令详解：按属性筛选并安全发送信号
sidebar_position: 11
description: 完整讲解 procps-ng pkill 参数、正则、UID/PPID/session/cgroup/namespace、pidfile、handler、queue、mrelease、退出码与宽匹配风险。
tags: [Linux, pkill, procps-ng, signal, cgroup]
---

# `pkill` 命令详解：按属性筛选并安全发送信号

`pkill` 与 `pgrep` 共用筛选器，但对匹配进程发送信号，默认 `SIGTERM`。它减少 `pgrep` 输出再传给 `kill` 的窗口，却仍可能宽匹配同名实例；服务/cgroup 控制面通常更安全。

## 1. 语法与完整参数

```text
pkill [option ...] pattern
```

共同筛选参数：`-A/--ignore-ancestors`、`-f/--full`、`-F/--pidfile`、`-g/--pgroup`、`-G/--group`、`-i/--ignore-case`、`-L/--logpidfile`、`-n/--newest`、`-o/--oldest`、`-O/--older`、`-p/--pid`、`-P/--parent`、`-r/--runstates`、`-s/--session`、`-t/--terminal`、`-u/--euid`、`-U/--uid`、`-x/--exact`、`--cgroup`、`--env`、`--ns`、`--nslist`、`-V/--version`、`-h/--help`。语义见 `pgrep` 篇。

pkill 专属/关键参数：

| 参数 | 作用 |
|---|---|
| `-SIGNAL`, `--signal SIGNAL` | 指定信号，默认 TERM |
| `-c`, `--count` | 输出匹配数量，不是成功发送数量 |
| `-e`, `--echo` | 显示收到发送尝试的名称与 PID |
| `-H`, `--require-handler` | 只向安装该信号用户态 handler 的进程发送 |
| `-m`, `--mrelease` | 信号后调用 `process_mrelease()` 尽快回收目标内存；新内核/高风险 |
| `-q`, `--queue VALUE` | 用 pidfd/sigqueue 携带整数值 |

`-v/--inverse` 和 `-w/--lightweight` 在 pkill 模式禁用，以避免灾难性反选或线程误用。`-a/-d/-l/-Q/--quiet` 是 pgrep 输出参数，不用于 pkill。

## 2. 先预览同一条件

```bash
pgrep -a -u myagent -x myagent
pkill -e -TERM -u myagent -x myagent
```

对于高风险环境，应先用 pgrep 完全相同筛选条件，核对 PID、启动时间、cgroup、namespace 和数量；随后仍可能发生变化，因此最终以发送后的验证为准。

`-f` 匹配完整 command line 很容易命中 wrapper、监控命令或其他租户；使用 `-A` 可排除 sudo/调用祖先，但不是完整安全边界。

## 3. 退出状态与等待

`0` 表示至少一个匹配且至少一个成功收到信号；`1` 无匹配或都无法发送；`2` 语法错误；`3` 致命错误。`-c` 数量不能证明多少发送成功。

pkill 只发信号，不默认等待退出。用服务管理器 stop/grace，或在已确认条件下结合 `pidwait`；不要无限轮询名称，因为 supervisor 可能重启新实例。

## 4. mrelease 与安全边界

`--mrelease` 请求内核在发信号后立即回收即将退出进程内存，适合特定 OOM/压力场景，但会改变正常退出期内存可用性和取证窗口。只在确认内核/权限/目标以及应用无需继续访问地址空间清理后使用，不能当普通 KILL 加速器。

## 5. 实验与掌握标准

创建同名不同 UID/PPID/session/cgroup 的测试进程；用相同 pgrep 条件预览后发送 TERM；覆盖 exact/full、pidfile 锁、handler、queue 和四种退出码。`mrelease` 只在隔离虚拟机评估。

掌握标准：能按共同/专属参数列全选项；能解释为何 count 不等于成功数；能避免宽匹配并验证 restart/cgroup/子进程收敛。

## 官方参考

- [procps-ng：pkill/pgrep(1)](https://man7.org/linux/man-pages/man1/pgrep.1.html)
- [Linux process_mrelease(2)](https://man7.org/linux/man-pages/man2/process_mrelease.2.html)

上一篇：[`kill` 命令详解](./10-kill命令详解.md)

下一篇：[`killall` 命令详解](./12-killall命令详解.md)
