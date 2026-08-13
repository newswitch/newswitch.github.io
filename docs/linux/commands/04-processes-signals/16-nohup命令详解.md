---
title: nohup 命令详解：忽略 SIGHUP、重定向终端与后台运行边界
sidebar_position: 16
description: 完整讲解 GNU coreutils nohup 参数、SIGHUP disposition、stdin/stdout/stderr 自动重定向、nohup.out 权限、后台符号、退出码和服务管理边界。
tags: [Linux, nohup, SIGHUP, 后台任务, coreutils]
---

# `nohup` 命令详解：忽略 SIGHUP、重定向终端与后台运行边界

`nohup` 让命令继承“忽略 SIGHUP”的 disposition，并在标准流连接终端时改向非 TTY。它不会自动在后台运行、创建新 session、关闭所有 fd、重启失败任务或保存状态。

## 1. 语法与 GNU 9.11 完整参数

```text
nohup COMMAND [ARG]...
nohup OPTION
```

| 参数 | 作用 |
|---|---|
| `--help` | 显示帮助 |
| `--version` | 显示版本 |

命令本身没有 `-o`、`-p` 等常见臆想参数；输出文件通过 Shell 重定向决定。

## 2. 标准流处理

若 stdin 是终端，GNU nohup 把它重定向到不可读对象；stdout 是终端时，追加到当前目录 `nohup.out`，失败则 `$HOME/nohup.out`；stderr 是终端时改到 stdout。

推荐全部显式声明：

```bash
nohup command --arg >app.log 2>&1 < /dev/null &
pid=$!
printf '%s\n' "$pid"
```

末尾 `&` 是 Shell 后台语法，不属于 nohup。显式日志避免多个任务争写同一个 `nohup.out`；注意日志轮转、磁盘满、敏感输出和目录权限。

## 3. SIGHUP 与继承

被 exec 的命令通常继承忽略 SIGHUP；程序可主动重置信号 disposition。Shell logout、SSH、systemd-logind、终端断开还可能通过其他信号、cgroup/session 清理、stdin EOF 或 stdout 错误影响进程。

```bash
ps -o pid,ppid,pgid,sid,tty,stat,comm -p "$pid"
ls -l /proc/$pid/fd
```

看到 TTY/打开 fd 仍存在就说明没有完整脱离。需要新 session 可评估 `setsid`，生产长期任务用 systemd/调度器。

## 4. 退出状态与可观测性

`125` nohup 自身失败，`126` 命令存在但不能执行，`127` 找不到命令，否则传播目标状态。但若后台启动，交互 Shell 立即得到的是“启动 wrapper”状态，最终状态需在同 Shell `wait $pid` 或由 supervisor 收集。

## 5. 实验与掌握标准

覆盖终端/文件三种标准流、显式/自动日志、前台/后台、SIGHUP handler 重置、Shell 退出、SSH session 与 systemd scope；观察 SID/TTY/fd/PPID 和最终退出码。

掌握标准：能列出全部参数；能解释 SIGHUP、后台、session、fd 重定向和监督是五个独立维度；不把 nohup 当服务管理器。

## 官方参考

- [GNU coreutils 9.11：nohup(1)](https://man7.org/linux/man-pages/man1/nohup.1.html)
- [Linux signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)

上一篇：[`renice` 命令详解](./15-renice命令详解.md)

下一篇：[`setsid` 命令详解](./17-setsid命令详解.md)
