---
title: strace 命令详解：系统调用、信号、文件描述符与延迟定位
sidebar_position: 3
description: 系统讲解 strace attach/launch、过滤表达式、follow-fork、时间戳/耗时、FD/path、统计、输出分片与生产开销。
tags: [Linux, strace, 系统调用, 延迟, 故障排查]
---

# `strace` 命令详解：定位进程与内核的交界

`strace` 通过 ptrace/seccomp 辅助机制观察系统调用、参数、返回值和信号。它能证明进程在等待哪个 FD、哪个路径返回 EACCES、连接为何超时；不能看到纯用户态计算，也可能显著改变高 syscall-rate 程序的时序。

## 1. 启动与附加

```text
strace [OPTIONS] COMMAND [ARG...]
strace [OPTIONS] -p PID...
```

| 参数 | 含义 |
|---|---|
| `-p PID` | 附加运行中 PID，可重复 |
| `-f`、`-ff` | 跟踪 fork/clone 子进程；`-ff` 配合输出按 PID 分文件 |
| `-D/-DD/-DDD` | tracer 自身作为 tracee 的 child/grandchild 等运行 |
| `-u USER` | 以用户身份启动 COMMAND |
| `-E VAR[=VAL]` | 删除或设置被跟踪命令环境 |
| `-b execve` | execve 时 detach |
| `-I N` | tracer 对致命信号的处理级别 |

## 2. 过滤、格式与时间

| 参数族 | 例子 | 用途 |
|---|---|---|
| syscall | `-e trace=%file,%network` | 按集合/名称筛选，可用 `!` 排除 |
| signal/status | `-e signal=...`、`-e status=failed` | 信号与成功/失败返回 |
| path/FD | `-P PATH`、`-e trace-fds=3,4`、`-y/-yy` | 路径或 FD 定位、解码 FD |
| 字符串 | `-s N`、`-xx` | 字符串上限、十六进制打印 |
| 时间 | `-t/-tt/-ttt`、`-T`、`-r` | 时间戳、syscall duration、相对时间 |
| stack | `-k`、`--stack-trace-frame-limit=N` | 用户栈（需符号支持） |
| output | `-o FILE`、`-A`、`-q/-qq/-qqq` | 输出文件、追加、安静级别 |
| 统计 | `-c/-C`、`-S SORT`、`-w` | 调用数/错误/时间汇总，墙钟口径 |
| 安全限制 | `--syscall-limit=N`、`--kill-on-exit` | 达到事件数停止、tracer 退出时杀 tracee |

版本 7 的表达式很多，准确全集以 `strace --help` 和官方 man page为准。

## 3. 从症状选择最小命令

```bash
# 配置为何打不开
strace -f -e trace=%file -e status=failed -s 256 -o open.log command

# 对已知 PID 短时观察网络和时间
timeout 20s strace -p 1234 -f -tt -T -yy -e trace=%network -o net.log

# 汇总，不输出每个事件
strace -f -c -w command
```

典型返回：`ENOENT` 路径/解释器不存在，`EACCES/EPERM` 检查 DAC/LSM/capability，`ECONNREFUSED` 到达目标但无监听/被拒绝，`ETIMEDOUT` 继续看网络路径与服务端，`EAGAIN` 要结合 nonblocking/资源限制。

## 4. 未完成调用与进程边界

多线程事件会出现 `<unfinished ...>` 和 `<... resumed>`，必须按 PID/TID 重组，不能把两行当两次调用。容器内 PID 与宿主 PID 不同；附加前固定宿主 PID、start time、Namespace 和 cgroup。Yama/LSM/capability 可能拒绝 attach，不要为一次排障永久关闭安全策略。

## 5. 生产纪律与验收

- 先筛 syscall/path/PID，再限 10～30 秒和输出大小。
- 高频 futex/read/write 逐事件打印开销很大，先 `-c` 或 perf/eBPF 聚合。
- 输出可能含密钥、HTTP payload、文件内容和用户数据，按敏感证据管理。
- `--kill-on-exit` 会改变 tracee 生命周期，生产慎用。

验收标准：能根据 errno 形成下一步验证，区分 syscall time 与 off-CPU 总延迟，解释 attach 为什么可能改变程序行为。

## 6. 官方参考

- [strace 7 manual](https://man7.org/linux/man-pages/man1/strace.1.html)

下一篇：[ltrace 命令详解](./04-ltrace命令详解.md)。
