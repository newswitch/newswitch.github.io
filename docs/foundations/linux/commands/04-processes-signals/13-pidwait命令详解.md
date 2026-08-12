---
title: pidwait 命令详解：用 pidfd 等待匹配进程退出
sidebar_position: 13
description: 完整讲解 procps-ng pidwait 的筛选参数、pidfile/stdin、pidfd_open 内核要求、非子进程等待、退出码、无法取得目标退出状态和监督器重启边界。
tags: [Linux, pidwait, pidfd, procps-ng, 进程等待]
---

# `pidwait` 命令详解：用 pidfd 等待匹配进程退出

`pidwait` 与 pgrep 共用筛选语法，但为匹配进程打开 pidfd 并等待其结束。它可以等待非当前 Shell 子进程，避免仅靠 PID 轮询的部分复用竞态；不能获得非子进程的原始 exit code。

## 1. 语法与参数

```text
pidwait [option ...] pattern
```

支持 pgrep 的筛选参数：`-A`、`-f`、`-F`、`-g`、`-G`、`-H`、`-i`、`-L`、`-n`、`-o`、`-O`、`-p`、`-P`、`-r`、`-s`、`--signal`（仅与 handler 筛选相关）、`-t`、`-u`、`-U`、`-v`、`-w`（选择 TID）、`-x`、`--cgroup`、`--env`、`--ns/--nslist`、`-V/--version`、`-h/--help`。

不适用 pgrep 输出项 `-a/-d/-l/-Q/--quiet`，也不使用 pkill 的发送项 `-e/-m/-q`。`-c/--count` 输出匹配数而非“成功等到的数量”。具体版本以 `pidwait --help` 为准。

## 2. 已知 PID/pidfile 的推荐用法

```bash
printf '%s\n' "$pid" | pidwait -F - '.*'
pidwait -F /run/myagent.pid -L '.*'
```

`-F -` 从 stdin 读 PID，`-L` 要求 pidfile 被锁，减少读取陈旧普通文本的风险。pattern 仍是必需操作数，可用精确条件进一步限制。

## 3. pidfd 边界

pidwait 要求 Linux 5.3+ 的 `pidfd_open(2)`。打开成功后 pidfd 指向同一进程对象，即使数字 PID 后来复用也不会等待错误对象。但在 pidfd 打开前，筛选与打开之间仍需处理进程退出；权限、procfs 可见性和内核限制也会影响。

对非子进程，pidwait 只能知道“pidfd 可读/进程结束”，不能调用 waitpid 取得其 exit status。需要业务退出码应由父进程 Bash `wait`、systemd/container runtime 或应用状态通道提供。

## 4. 退出状态和监督器重启

`0`：至少一项匹配且成功等待；`1`：无匹配或无法等待；`2`：语法错误；`3`：致命错误。

它只等待初始匹配集合；systemd/Kubernetes 可能随后启动新 PID。因此“旧 PID 已退出”不等于服务停止，必须验证 unit/Pod/cgroup desired state。

## 5. 实验与掌握标准

等待当前 Shell child 与无亲缘进程，对比 Bash wait；覆盖 pidfile lock、stdin、PID/TID、namespace/cgroup、内核不支持与四种退出码；模拟 supervisor 重启。

掌握标准：能说明共享/不适用的全部参数；能解释 pidfd 解决什么竞态、为何拿不到非 child 的 exit code，以及何时应使用服务控制面。

## 官方参考

- [procps-ng：pidwait/pgrep(1)](https://man7.org/linux/man-pages/man1/pgrep.1.html)
- [Linux pidfd_open(2)](https://man7.org/linux/man-pages/man2/pidfd_open.2.html)

上一篇：[`killall` 命令详解](./12-killall命令详解.md)

下一篇：[`nice` 命令详解](./14-nice命令详解.md)
