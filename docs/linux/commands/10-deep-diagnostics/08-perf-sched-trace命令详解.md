---
title: perf sched 与 perf trace 命令详解：调度延迟和系统调用时间线
sidebar_position: 8
description: 讲清 perf sched record/timehist/latency/map/replay 与 perf trace 的 syscall、tracepoint、PID/cgroup、summary 和过滤。
tags: [Linux, perf sched, perf trace, 调度延迟, 系统调用]
---

# `perf sched` 与 `perf trace`：分析 off-CPU 与事件时间线

CPU hotspot 只能解释 on-CPU。线程慢可能在 runnable queue 等 CPU，也可能睡眠等待锁、IO 或网络。`perf sched` 分析调度 tracepoint；`perf trace` 提供类似 strace 的事件流和汇总，通常能利用 perf ring buffer 降低逐次 ptrace 开销。

## 1. perf sched 工作流

```bash
sudo perf sched record -p 1234 -- sleep 20
sudo perf sched timehist -i perf.data --pid 1234
sudo perf sched latency -i perf.data
sudo perf sched map -i perf.data
```

| 子命令 | 用途 |
|---|---|
| `record` | 录制 sched_switch/wakeup/migrate 等事件 |
| `timehist` | 按时间显示运行、等待、调度延迟 |
| `latency` | 按任务汇总调度延迟 |
| `map` | 文本 CPU 调度图 |
| `replay` | 用合成 workload 重放调度形态；会主动负载，仅实验使用 |

`timehist` 常用过滤包含 `--pid/--tid/--cpu`、`--state`、`--show-prio`、`--show-next`、`--summary`、`--time START,END`，以本机版本为准。

## 2. perf trace 参数族

```bash
perf trace -p 1234 --duration 10
perf trace -e 'syscalls:sys_enter_openat' -p 1234
perf trace record -p 1234 -- sleep 10
perf trace --summary -- command
```

| 参数 | 含义 |
|---|---|
| `-e EVENT` | syscall/tracepoint 选择，可用表达式过滤 |
| `-p/--pid`、`-t/--tid`、`-a`、`-C`、`-G` | 目标范围 |
| `--duration MS` | 只显示超过阈值的事件（注意不是总运行时） |
| `--failure/--success` | 按返回状态筛选 |
| `-s, --summary`、`--summary-only` | 事件汇总 |
| `--call-graph METHOD`、`--kernel-syscall-graph` | 调用栈 |
| `--max-events N` | 限制事件数量 |
| `--output FILE` | 文本输出 |
| `--sort-events` | 按时间排序异步事件 |

不同 perf 版本的 `trace` 选项变化较快，尤其 BPF augment 与 system-wide 行为，先看 `perf trace -h`。

## 3. 判断调度瓶颈

| 证据 | 解释方向 |
|---|---|
| runnable delay 高 | CPU 饱和、quota throttling、优先级/affinity/NUMA |
| sleep time 高 | futex、epoll、IO、timer 等等待；继续关联 syscall/stack |
| 频繁 migrate | affinity、load balance、cache locality |
| 短线程海量切换 | 工作切分、锁竞争、线程池或 wakeup storm |

调度 latency 不等于业务 latency；必须关联请求/线程和应用时间线。容器还要同时检查 `cpu.stat` throttling。

## 4. 安全与验收

限制 PID/CPU/事件/时长；`perf sched replay` 会制造负载，生产禁用。验收标准：能区分 runnable、running、sleeping 与 throttled，并用 syscall 或 stack 解释线程为何离开 CPU。

## 5. 官方参考

- [perf-sched(1)](https://man7.org/linux/man-pages/man1/perf-sched.1.html)
- [perf-trace(1)](https://man7.org/linux/man-pages/man1/perf-trace.1.html)

下一篇：[trace-cmd 命令详解](./09-trace-cmd命令详解.md)。
