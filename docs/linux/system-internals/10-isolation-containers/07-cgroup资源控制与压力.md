---
title: "cgroup 的 CPU、内存、IO 与 PID 控制：限制值如何变成运行时行为"
sidebar_label: "07. cgroup 资源控制与压力"
sidebar_position: 7
description: "串联 cpu.max/weight、memory.high/max、io.max/weight、pids.max 和 PSI 的行为与排障。"
tags: [Linux, cgroup v2, CPU Throttling, Memory High, PSI]
---

# cgroup 的 CPU、内存、IO 与 PID 控制：限制值如何变成运行时行为

cgroup 参数并不都表示硬上限。weight 用于竞争时的相对份额，max 通常是上限，high 常用于节流/回收压力；必须理解每个控制器的反馈方式。

## 1. CPU

| 文件 | 作用 |
|---|---|
| `cpu.weight` | 有竞争时的相对份额 |
| `cpu.max` | quota/period 带宽上限，`max` 表示不设 quota |
| `cpu.stat` | usage、nr_periods、nr_throttled、throttled_usec 等 |
| `cpuset.cpus.effective` | 在祖先/在线状态约束后真正可用 CPU |

服务可在周期前半段耗尽 quota，后半段被 throttle，造成周期性 P99 尖峰；整机仍可能有空闲 CPU。

## 2. 内存

- `memory.current`：当前记账量。
- `memory.low/min`：回收保护程度。
- `memory.high`：超出后让分配路径承受回收/节流压力。
- `memory.max`：硬边界，无法回收时可触发 memcg OOM。
- `memory.events`：low/high/max/oom/oom_kill 事件。

`memory.current`、RSS、working set、应用 heap 是不同口径。

## 3. IO

`io.weight` 在同一底层设备有竞争时分配权重；`io.max` 可按 major:minor 限制 rbps/wbps/riops/wiops。Buffered IO 可能先进入 page cache，写回阶段才被底层设备控制，观测要覆盖回写和直接 IO。

## 4. PID

`pids.max` 限制任务数量，达到后 fork/clone 返回 `EAGAIN`。线程也消耗 PID controller 计数，因此线程泄漏会表现为“无法创建进程”。

## 5. PSI

```bash
cat /sys/fs/cgroup/<path>/cpu.pressure
cat /sys/fs/cgroup/<path>/memory.pressure
cat /sys/fs/cgroup/<path>/io.pressure
```

PSI `some` 表示至少一个可运行任务因该资源停顿，`full` 表示所有非 idle 任务同时停顿（CPU 不提供 full）。它是时间占比压力，不是容量利用率。

## 6. 统一现场

```bash
cat /proc/<PID>/cgroup
cg=/sys/fs/cgroup/<resolved-path>
cat "$cg"/{cpu.stat,memory.current,memory.events,pids.current,pids.events} 2>/dev/null
```

真实路径要从 `/proc/PID/cgroup` 与 mountinfo 解析，容器内可能经过 cgroup Namespace 相对化。

## 7. 练习与答案

**问题：`memory.high` 事件增长但没有 OOM，是否没有影响？**

答案：有影响。分配者可能在直接回收中停顿并产生延迟；应结合 memory PSI、reclaim 和业务 P99。

**问题：提高 `cpu.weight` 能突破 `cpu.max` 吗？**

答案：不能。weight 分配竞争份额，max 是独立带宽上限。

下一篇：[OCI 镜像、Bundle 与容器创建链路](./08-OCI镜像-Bundle与容器创建链路.md)
