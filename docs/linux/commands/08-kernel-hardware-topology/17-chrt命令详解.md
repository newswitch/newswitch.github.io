---
title: chrt 命令详解：Linux 调度策略、实时优先级与 Deadline 参数
sidebar_position: 17
description: 完整讲解 chrt 的全部参数、OTHER/BATCH/IDLE/FIFO/RR/DEADLINE/EXT 策略、runtime-deadline-period 约束、线程语义、权限和实时风险。
tags: [Linux, chrt, 实时调度, SCHED_DEADLINE, CPU调度]
---

# `chrt` 命令详解：Linux 调度策略、实时优先级与 Deadline 参数

`chrt` 查询或修改线程的 scheduling policy 和实时属性。它不设置 CPU affinity、不设置 nice 的所有语义、也不提供 CPU 带宽隔离。`SCHED_FIFO` 配置错误能饿死系统关键线程，必须先在有独立控制台的测试节点验证。

## 1. 语法

```text
chrt [OPTIONS] [PRIORITY] COMMAND [ARG...]
chrt --pid [OPTIONS] [PRIORITY] PID[:PIDFS_INODE]
```

```bash
chrt -p 1234                 # 查询
sudo chrt -r -p 30 1234     # 修改为 RR/30
sudo chrt -f 20 -- ./worker # 新进程 FIFO/20
```

新版本可用 `PID:inode` 防止长自动化中的 PID 重用，需 pidfs/getino 支持。

## 2. 全部策略参数

| 短参数 | 长参数 | 策略与语义 |
|---|---|---|
| `-o` | `--other` | `SCHED_OTHER`，普通分时调度 |
| `-b` | `--batch` | `SCHED_BATCH`，CPU 密集批处理提示 |
| `-i` | `--idle` | `SCHED_IDLE`，极低调度权重工作 |
| `-f` | `--fifo` | `SCHED_FIFO`，高优先级 runnable 线程可一直运行到阻塞/让出/被更高优先级抢占 |
| `-r` | `--rr` | `SCHED_RR`，同优先级 FIFO 线程间有时间片轮转 |
| `-d` | `--deadline` | `SCHED_DEADLINE`，按 runtime/deadline/period 预约 |
| `-e` | `--ext` | `SCHED_EXT`，由已加载 BPF scheduler 定义；需 Linux 6.12+ 和相应配置 |

FIFO/RR 使用非零实时 priority，范围用 `chrt -m` 查。OTHER/BATCH/IDLE/DEADLINE/EXT 通常 priority 为 0；util-linux 2.42+ 对这些策略可省略 0。

## 3. 调度属性全部参数

| 参数 | 含义 |
|---|---|
| `-T NS`、`--sched-runtime NS` | DEADLINE runtime budget；Linux 6.12+ 也可为 OTHER/BATCH 设置自定义 slice |
| `-D NS`、`--sched-deadline NS` | DEADLINE 的相对 deadline |
| `-P NS`、`--sched-period NS` | DEADLINE period，内核下限通常 100 微秒 |
| `-G`、`--reclaim-grub` | DEADLINE 启用 GRUB 未用带宽回收 |
| `-O`、`--deadline-overrun` | DEADLINE 超预算设置通知标志，触发 `SIGXCPU` 而不只是静默节流 |
| `-R`、`--reset-on-fork` | 子进程不继承特权实时策略/负 nice；设置后清除也需权限 |

DEADLINE 必须满足：

```text
runtime <= deadline <= period
```

若省略 deadline/runtime，新版 chrt 会分别从 period/deadline 复制，但明确写全更利于审计。所有值是纳秒。

## 4. 其他全部参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a` | `--all-tasks` | 对 PID 的所有线程操作 |
| `-m` | `--max` | 显示各策略有效 priority 范围并退出 |
| `-p` | `--pid` | 操作已有 PID；不给新属性时查询 |
| `-v` | `--verbose` | 显示状态信息 |
| `-h` | `--help` | 显示帮助 |
| `-V` | `--version` | 显示 util-linux 版本 |

调度属性是 per-thread。多线程服务只改主线程可能没有效果，先用：

```bash
chrt -ap PID
ps -L -p PID -o pid,tid,cls,rtprio,pri,ni,psr,stat,comm
```

## 5. 实时类为什么会拖死机器

在同一 CPU 上，高优先级 FIFO 线程若不阻塞，就能阻止低优先级 sshd、监控、存储回写和 watchdog 运行。最低安全措施：

- 把实验绑到专用 CPU，并规划 housekeeping CPU；
- 设置 cgroup/runtime throttling 和应用 watchdog；
- 使用 `--reset-on-fork` 避免子进程继承；
- 保留 BMC/串口控制台；
- 先用 RR 和低 priority 验证，再逐步调整；
- 观察 `/proc/sys/kernel/sched_rt_runtime_us` 等平台策略。

实时 priority 数字越大越高，与 nice “数字越小越优先”不同。

## 6. Deadline 不是“给 PID 一个截止时间”

```bash
sudo chrt -d -T 2000000 -D 8000000 -P 10000000 -- ./periodic-worker
```

表示每 10ms period 最多运行约 2ms，期望在 8ms deadline 前完成。内核还做 admission control，预约带宽超限会返回错误。任务若不是稳定的周期工作，乱填参数会产生节流和尾延迟。

## 7. 权限与容器

读取通常无需特权；改变他人或提升实时属性通常需要 `CAP_SYS_NICE`，并受 RLIMIT_RTPRIO、cgroup、seccomp 和容器 runtime 限制。容器拥有 capability 也仍共享宿主机 scheduler，错误实时线程可影响整机。

## 8. 与其他控制面的关系

| 目标 | 工具/接口 |
|---|---|
| 在哪些 CPU 运行 | `taskset` / cpuset cgroup |
| 普通类相对权重 | `nice`、cgroup `cpu.weight` |
| 实时/Deadline 策略 | `chrt` |
| CPU 带宽上限 | cgroup `cpu.max`、RT runtime 策略 |
| NUMA 页放置 | `numactl` |
| IRQ 所在 CPU | IRQ affinity、irqbalance、RPS/XPS |

## 9. 官方参考

- [util-linux：chrt(1)](https://man7.org/linux/man-pages/man1/chrt.1.html)
- [Linux：sched(7)](https://man7.org/linux/man-pages/man7/sched.7.html)

下一篇：[lsirq 命令详解](./18-lsirq命令详解.md)。
