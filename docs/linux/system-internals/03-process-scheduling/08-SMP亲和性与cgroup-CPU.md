---
title: "SMP、CPU 亲和性与 cgroup CPU：为什么整机有空闲核，任务仍然排队"
sidebar_label: "08. SMP、亲和性与 cgroup CPU"
sidebar_position: 8
description: "串联每 CPU 运行队列、负载均衡、affinity、cpuset、CPU quota、throttling、PSI 与容器 CPU 观测。"
tags: [Linux, SMP, CPU Affinity, cgroup v2, CPU Throttling]
---

# SMP、CPU 亲和性与 cgroup CPU：为什么整机有空闲核，任务仍然排队

多核系统的“总 CPU 使用率”会隐藏局部约束。任务能否使用某个 CPU，取决于 CPU online 状态、调度亲和性、cpuset、cgroup 配额、调度类和硬件拓扑。

## 1. 可见、允许与可获得不是一回事

```text
系统 present CPU
  ∩ online CPU
  ∩ task affinity
  ∩ cpuset 有效 CPU
  ∩ 调度类/隔离规则
= 任务可能运行的 CPU 集合

在这个集合内还要竞争运行队列和 cgroup 配额。
```

容器里 `/proc/cpuinfo` 可能显示宿主机所有 CPU，但任务实际受 cpuset 或 quota 限制。

## 2. Affinity 与 cpuset

任务 affinity 是允许运行的 CPU 位图；cpuset cgroup 从资源层次限制一组任务可用的 CPU 和内存节点。有效集合是多重约束的交集。

```bash
taskset -pc <PID>
grep Cpus_allowed_list /proc/<PID>/status
cat /proc/<PID>/cgroup
cat /sys/fs/cgroup/<path>/cpuset.cpus.effective 2>/dev/null
```

绑核可以提高缓存和 NUMA 局部性，也会减少调度器避开热点的空间。将所有业务线程和网卡 IRQ 绑到同一组核，可能在整机空闲时制造局部拥塞。

## 3. cgroup v2 CPU 控制

常见接口：

| 文件 | 作用 |
|---|---|
| `cpu.weight` | 有竞争时的相对份额 |
| `cpu.max` | 每周期可使用的 CPU 时间配额 |
| `cpu.stat` | 使用时间、节流次数和节流时间 |
| `cpuset.cpus.effective` | 层级约束后的有效 CPU |
| `cpu.pressure` | 该 cgroup 的 CPU 等待压力 |

例如：

```text
cpu.max = 200000 100000
```

表示每 100ms 周期最多获得 200ms CPU 时间，理论上相当于 2 个 CPU 的时间预算，但可以在允许的多个 CPU 上并行快速耗尽。它不是固定绑定两个核。

## 4. Throttling 为什么造成长尾

服务线程在周期前半段高并发消耗完 quota 后，会被节流到下一周期。整机 CPU 可能仍低，但该 cgroup 请求出现周期性停顿。

```bash
cat /sys/fs/cgroup/<path>/cpu.stat
```

示例：

```text
usage_usec 918273645
nr_periods 120034
nr_throttled 28411
throttled_usec 93450122
```

判断时观察区间增量，而不是累计绝对值，并与请求延迟同一时间窗对齐。

## 5. 负载均衡与 CPU 迁移

调度器会尝试在 CPU 间平衡任务，但受到 affinity、cpuset、调度域、Cache 拓扑、NUMA 和任务唤醒位置影响。频繁迁移可能破坏 Cache 局部性；完全不迁移又可能让某个队列过载。

```bash
pidstat -u -w -t -p <PID> 1
mpstat -P ALL 1
perf stat -e context-switches,cpu-migrations -p <PID> -- sleep 10
```

## 6. Load Average 的正确使用

load average 是全局趋势，不按 CPU 数自动归一化，也不直接等于某个容器压力。应联合：

- `vmstat r`：当前可运行任务数量采样。
- 每 CPU `%idle/%system/%soft`。
- 任务允许 CPU 集合。
- cgroup `cpu.stat` 和 `cpu.pressure`。
- 调度延迟和业务延迟。
- D 状态与 IO PSI。

## 7. 一个定位示例

现象：64 核节点总 CPU 只有 25%，推理前处理 P99 却周期性升高。

证据链：

1. Pod 限制为 4 CPU quota，但未固定 cpuset。
2. `cpu.stat` 的 `nr_throttled` 和 `throttled_usec` 在延迟窗口快速增加。
3. 应用瞬时并行线程远大于 4，在周期前半段耗尽配额。
4. 宿主机剩余 CPU 不属于该 cgroup 时间预算，不能直接使用。

解决方向可以是校准 requests/limits、降低无效线程并行、错开批处理或评估静态 CPU 管理。不能只因为宿主机空闲就断定不是 CPU 层问题。

## 8. 练习与答案

**问题：`cpu.max=200000 100000` 是否等于绑定 CPU0 和 CPU1？**

答案：不是。它限制每个周期可消耗的总 CPU 时间；在哪些核运行由 affinity/cpuset 和调度器决定。

**问题：CPU PSI 高但利用率没有 100%，可能是什么原因？**

答案：局部 CPU 集合过载、cgroup 节流、单核热点或任务限制都可能使部分任务等待，而系统其他 CPU 空闲。

下一模块：[Linux 内存管理导读](../04-memory-management/00-Linux内存管理导读.md)
