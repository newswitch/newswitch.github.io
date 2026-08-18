---
title: "disown 命令详解：移除作业记录与 SIGHUP 标记"
sidebar_label: "08. disown 命令详解：移除作业记录与 SIGHUP 标记"
sidebar_position: 8
description: "完整讲解 Bash disown 的 -a/-r/-h 参数、jobspec/PID、作业表移除、SIGHUP 标记、终端 I/O 和可靠后台运行边界。"
tags: [Linux, Bash, disown, SIGHUP, 后台任务]
---

# disown 命令详解：移除作业记录与 SIGHUP 标记

`disown` 修改当前 Bash 的作业表或“Shell 退出时不向该作业发送 SIGHUP”标记。它不会改变进程 PPID/SID/PGID、不会关闭 TTY 文件描述符、不会建立日志和监督，也不是守护化工具。

## 1. 语法与完整参数

```text
disown [-ar] [-h] [jobspec ... | pid ...]
```

| 参数 | 作用 |
|---|---|
| `-a` | 未指定对象时处理全部作业 |
| `-r` | 未指定对象时只处理 running 作业 |
| `-h` | 不从作业表移除，只标记 Shell 不向其发送 SIGHUP |

省略对象与选项时处理当前作业。可接受 jobspec，部分场景也可用对应 PID；以 `help disown` 为本 Bash 最终依据。

## 2. 移除与 hangup 标记

```bash
long_command >task.log 2>&1 < /dev/null &
jobs -l
disown -h %1   # 仍在 jobs 中，但退出 Shell 时不主动 HUP
disown %1      # 从作业表移除
```

移除后 `jobs/fg/bg/wait jobspec` 不再管理它，但进程仍可能因终端关闭、session 管理器、SSH/systemd-logind、stdin EOF、stdout 写失败或其他策略退出。

## 3. 为什么不适合生产服务

可靠服务需要：明确 stdout/stderr、工作目录和环境；restart/health；资源/cgroup 限制；日志轮转；依赖和关闭顺序；审计。`disown` 一个都不提供。交互 Shell 补救可用，生产长期任务应使用 systemd、调度器、Kubernetes 或 tmux/screen（交互会话）。

## 4. 退出状态、实验与掌握标准

对象有效并处理成功返回 `0`；无 job control、jobspec/PID 无效等返回非零。`-h` 成功不证明任务能活过 logout。

实验：分别保留/不保留 TTY I/O，测试 `disown` 与 `-h/-a/-r`，退出 Shell 后观察 PID/PPID/SID/fd 和日志；与 `nohup`、`setsid`、systemd-run 比较。

掌握标准：能列出全部参数；能明确“从作业表移除”“不由 Bash 发送 HUP”“脱离终端”“服务监督”四者不同。

## 5. 官方参考 {/* #官方参考 */}

- [GNU Bash：Job Control Builtins](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html)
- [Linux session-leader termination](https://man7.org/linux/man-pages/man3/exit.3.html)

上一篇：[`fg` 命令详解](./07-fg命令详解.md)

下一篇：[`wait` 命令详解](./09-wait命令详解.md)
