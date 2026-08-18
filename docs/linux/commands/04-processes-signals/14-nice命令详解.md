---
title: "nice 命令详解：以调整后的 CPU 调度权重启动程序"
sidebar_label: "14. nice 命令详解：以调整后的 CPU 调度权重启动程序"
sidebar_position: 14
description: "完整讲解 GNU coreutils nice 参数、增量 niceness、-20 到 19、权限、CFS 权重、cgroup 与实时调度边界及退出码。"
tags: [Linux, nice, CPU调度, CFS, coreutils]
---

# nice 命令详解：以调整后的 CPU 调度权重启动程序

`nice` 用调整后的 niceness 启动新程序；无命令时显示当前 niceness。它影响普通调度策略下的相对 CPU 权重，不限制 CPU 上限，也不控制内存、I/O、GPU、NUMA、affinity 或实时调度。

## 1. 语法与 GNU 9.11 完整参数

```text
nice [OPTION] [COMMAND [ARG]...]
```

| 参数 | 作用 |
|---|---|
| `-n N`, `--adjustment=N` | 在当前 niceness 上增加整数 N；省略时默认增加 10 |
| `--help` | 显示帮助 |
| `--version` | 显示版本 |

Shell 可能有自己的 nice；先检查：

```bash
type -a nice
env nice --version
nice
```

## 2. 增量而不是绝对值

```bash
# 当前为 0，则目标通常为 10
nice command

# 在当前值上增加 5
nice -n 5 command

# 请求降低 niceness（提高 CPU 权重），通常需要 CAP_SYS_NICE/rlimit
nice -n -5 command
```

范围是 `-20`（更有利）到 `19`（更礼让）。nice 的 `-n` 是增量，而 `renice --priority` 默认设置绝对值，这是常见混淆。

## 3. 调度语义

在 CFS/EEVDF 等普通调度策略中，niceness 映射到权重：有 CPU 竞争时影响份额，不保证固定比例、响应时间或独占。无竞争时 nice 19 的任务仍可使用整个 CPU。

```bash
ps -o pid,cls,pri,ni,psr,%cpu,comm -p PID
```

实时 `SCHED_FIFO/RR/DEADLINE` 不按普通 nice 权重运行；cgroup `cpu.weight/cpu.max`、cpuset 和 throttling 也会先形成更高层约束。线程可有各自 niceness，观察时用 `ps -L`。

## 4. 权限与服务配置

普通用户通常可增加 niceness（让任务更礼让），不能随意降低；`RLIMIT_NICE` 与 `CAP_SYS_NICE` 可放宽。systemd 服务应在 unit 中声明 `Nice=`，避免依赖启动 Shell；Kubernetes 要主要通过 requests/limits、QoS/cgroup 管理，nice 仅是节点内补充。

## 5. 退出状态、实验与掌握标准

`125` 表示 nice 自身失败，`126` 命令存在但不可执行，`127` 命令未找到，否则传播目标命令状态。

实验：两个 CPU 竞争进程使用不同 niceness，观察单独运行与竞争时差异；比较线程、cgroup CPU weight/max 和实时策略；验证普通用户提高/降低权重的权限。

掌握标准：能列出全部参数；能解释增量、范围和退出码；不把 nice 当限流/实时/CPU affinity 或 GPU 调度工具。

## 6. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：nice(1)](https://man7.org/linux/man-pages/man1/nice.1.html)
- [Linux sched(7)](https://man7.org/linux/man-pages/man7/sched.7.html)

上一篇：[`pidwait` 命令详解](./13-pidwait命令详解.md)

下一篇：[`renice` 命令详解](./15-renice命令详解.md)
