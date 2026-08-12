---
title: jobs 命令详解：Shell 作业表、jobspec 与进程组
sidebar_position: 5
description: 完整讲解 Bash jobs 的参数、作业状态、jobspec、当前/前一作业、PID/PGID、仅本 Shell 可见的边界及脚本使用方法。
tags: [Linux, Bash, jobs, 作业控制, process group]
---

# `jobs` 命令详解：Shell 作业表、jobspec 与进程组

`jobs` 是 Bash builtin，显示当前 Shell 自己维护的作业表。作业通常是一条异步/停止的 pipeline，对应一个 process group；另一个终端、父 Shell、systemd 或 `ps` 看不到这张 Shell 内部表。

## 1. 语法与完整参数

```text
jobs [-lnprs] [jobspec ...]
jobs -x command [args ...]
```

| 参数 | 作用 |
|---|---|
| `-l` | 除默认信息外显示各进程 PID |
| `-n` | 只显示上次通知后状态发生变化的作业 |
| `-p` | 只显示作业 process group leader 的 PID |
| `-r` | 只显示 running 作业 |
| `-s` | 只显示 stopped 作业 |
| `-x command ...` | 将 command 参数中的 jobspec 替换成对应 PGID 后执行 |

```bash
type jobs
help jobs
set -o | grep monitor
```

非交互 Shell 默认通常关闭 job control；脚本中 jobspec、PGID 和通知行为可能不同，不应把交互技巧直接搬入守护进程。

## 2. jobspec 语法

| 写法 | 含义 |
|---|---|
| `%n` | 作业号 n |
| `%%` / `%+` | 当前作业 |
| `%-` | 前一个作业 |
| `%prefix` | 命令行以 prefix 开头的唯一作业 |
| `%?text` | 命令行包含 text 的唯一作业 |

`+/-` 是 Shell 动态选择，不是稳定标识；模糊/不唯一 jobspec 会报错。`$!` 是最近异步 pipeline 的 PID/实现相关 leader 标识，不等于任意 jobspec。

## 3. 作业状态与进程组

```bash
sleep 300 &
jobs -l
ps -o pid,ppid,pgid,sid,tty,tpgid,stat,comm -p "$!"
```

Running/Stopped/Done 描述 Shell 观察到的作业状态。pipeline 含多个进程，默认一行可能隐藏成员；用 `jobs -l`、`ps --forest` 补齐。前台 process group 拥有终端读写权；后台读终端常收到 `SIGTTIN`，在启用 `tostop` 时写终端可能收到 `SIGTTOU`。

## 4. `jobs -x` 与外部命令

```bash
jobs -x ps -o pid,pgid,sid,stat,comm -g %1
```

`-x` 用 PGID 替换 jobspec，不是把命令放到作业内运行。替换后的负数/选项边界要谨慎，优先让 command 显式接受 PGID 参数。

## 5. 退出状态、实验与掌握标准

成功返回 `0`；jobspec 无效、选项错误或 `-x` 命令失败返回非零/目标命令状态。作业已结束但尚未通知/清理时可能短暂存在于表中。

实验：创建单进程与 pipeline 作业；用 Ctrl-Z 停止；观察 `%+/%-` 变化、`-l/-p/-n/-r/-s/-x`；在另一个 Shell 证明看不到原作业表。

掌握标准：能列出全部参数和 jobspec；能从 PID/PGID/SID/TTY 解释作业；不使用 `jobs` 监控独立服务。

## 官方参考

- [GNU Bash：Job Control Builtins](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html)
- [Linux credentials(7)：process groups and sessions](https://man7.org/linux/man-pages/man7/credentials.7.html)

上一篇：[`pstree` 命令详解](./04-pstree命令详解.md)

下一篇：[`bg` 命令详解](./06-bg命令详解.md)
