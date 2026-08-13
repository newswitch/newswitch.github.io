---
title: perf stat 命令详解：CPU 周期、指令、缓存、复用与指标解释
sidebar_position: 5
description: 系统讲解 perf stat 的事件、PID/CPU/cgroup 作用域、重复、区间、聚合、输出、metric group 和 multiplexing。
tags: [Linux, perf stat, PMU, CPU, 性能分析]
---

# `perf stat` 命令详解：先计数，再采样

`perf stat` 对一段工作负载或目标 PID/CPU/cgroup 统计 PMU、软件和 tracepoint 事件。它回答“这段时间发生了多少 cycles/instructions/cache miss/context switch”，不告诉你具体热点函数。

## 1. 作用域与核心参数

```text
perf stat [OPTIONS] [COMMAND]
perf stat [OPTIONS] -p PID|-t TID|-a
```

| 参数族 | 代表参数 | 含义 |
|---|---|---|
| 事件 | `-e EVENT`、`--event`、`-M METRIC`、`--metric-only` | 事件/metric，可重复或成组 `{a,b}` |
| 目标 | `-p PID`、`-t TID`、`-a`、`-C CPU-LIST`、`-G CGROUP` | 进程、线程、系统、CPU、cgroup |
| 执行 | `-r N`、`--repeat`、`--timeout MS`、`--delay MS` | 重复、期限、延迟启用 |
| 区间 | `-I MS`、`--interval-print`、`--interval-count N` | 周期输出增量 |
| 聚合 | `--per-core/socket/die/node/thread/cache`、`-A` | 硬件拓扑聚合或不聚合 |
| 输出 | `-o FILE`、`--append`、`-x SEP`、`--json-output`、`--no-big-num` | 文件、CSV/JSON、数字格式 |
| 控制 | `--all-user`、`--all-kernel`、`--sync`、`--no-merge` | 用户/内核态与事件合并 |
| 继承 | `-i, --no-inherit`、`--enable-on-exec` | 子任务继承/exec 后启用 |

```bash
perf list
perf stat -e cycles,instructions,branches,branch-misses,cache-misses -- command
perf stat -p 1234 -I 1000 --timeout 10000
perf stat -a -C 0-7 --per-core sleep 10
```

## 2. 指标关系

```text
IPC = instructions / cycles
miss rate = cache-misses / cache-references
CPU utilization 需要结合 task-clock、elapsed time 和 CPU 数
```

IPC 高低没有跨工作负载统一好坏标准；cache miss 事件含义由 CPU 微架构定义。虚拟机、容器和 heterogeneous core 还会影响 PMU 可用性。

## 3. multiplexing 与尺度

硬件计数器数量有限，事件过多会 time-multiplex。输出中的 running/enabled 比例低，说明计数被缩放，误差更大。优先少量相关事件或 metric group，多次重复并给出方差；不要一次塞入全部 `perf list`。

## 4. cgroup 与权限边界

系统范围通常需更高权限，受 `perf_event_paranoid`、lockdown 和 PMU reservation 限制。`-G` 常与 system-wide CPU 作用域配合，并要求目标 cgroup 路径正确。容器内可见 CPU/cgroup 与宿主不同，报告中必须记录观察点。

## 5. 验收与参考

能解释 cycles、instructions、task-clock、context-switch、fault 和 multiplexing；能先比较同机同版本基线，再决定是否进入 `perf record`。

- [Linux perf-stat(1)](https://man7.org/linux/man-pages/man1/perf-stat.1.html)
- [Linux perf-list(1)](https://man7.org/linux/man-pages/man1/perf-list.1.html)

下一篇：[perf record/report 命令详解](./06-perf-record-report命令详解.md)。
