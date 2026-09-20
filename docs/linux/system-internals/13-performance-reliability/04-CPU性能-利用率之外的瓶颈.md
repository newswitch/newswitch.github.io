---
title: "CPU 性能：利用率之外的频率、IPC、锁、IRQ 与调度瓶颈"
sidebar_label: "04. CPU 性能瓶颈"
sidebar_position: 4
description: "从 runnable、频率、IPC、前后端 stall、锁、softirq、NUMA 和 cgroup 解释 CPU 性能。"
tags: [Linux, CPU Performance, IPC, Scheduler, Softirq]
---

# CPU 性能：利用率之外的频率、IPC、锁、IRQ 与调度瓶颈

CPU 利用率表示时间归类，不表示每周期完成多少有效工作，也不显示任务是否被限制在局部 CPU 集合。

## 1. 先分时间状态

```bash
mpstat -P ALL 1
pidstat -u -w -t -p <PID> 1
vmstat 1
```

user/system/iowait/irq/softirq/steal 口径不同。iowait 是 CPU 空闲且有特定 IO 等待的时间，不是进程 IO 延迟总和；虚拟机 steal 表示 vCPU 想运行但宿主未调度。

## 2. 任务为何没运行

- runnable 但在 run queue 等待。
- affinity/cpuset 限定的核已满。
- `cpu.max` quota 耗尽。
- 高优先级/实时任务抢占。
- 锁或 futex 睡眠，此时不计 runnable。

## 3. 正在运行却慢

- 频率受 governor、功耗、温度限制。
- cache/TLB miss 和内存带宽 stall。
- 分支预测失败、前端取指受限。
- 错误共享导致 Cache line 来回迁移。
- 标量/低效指令替代向量化。

```bash
perf stat -e task-clock,cycles,instructions,branches,branch-misses,cache-misses -- <workload>
perf record -g -p <PID> -- sleep 20
```

事件名称与含义依 CPU，跨机比较先确认型号、微码、频率策略和 PMU 支持。

## 4. IRQ/Softirq

业务线程 CPU 不高，但 NIC 中断/NAPI 占用一个核，同样会导致网络长尾。结合 `/proc/interrupts`、`/proc/softirqs`、RSS 和队列统计，而不是把内核工作当“空闲资源”。

## 5. NUMA

线程在 Node 0、内存在 Node 1、设备在 Node 0/1 会产生不同互连流量。绑定 CPU 而不绑定内存可能更差；应测 local/remote access、迁移和带宽，保持线程、内存、IRQ 和设备局部性。

## 6. 练习与答案

**问题：CPU 100% 能否证明增加核数会线性提升吞吐？**

答案：不能。可能受锁、内存带宽、串行区、单队列或频率下降限制；需要检查可并行部分和 scaling curve。

**问题：上下文切换多一定是坏事吗？**

答案：不是。事件驱动和多线程会正常切换；问题是切换成本相对有效工作过高或伴随 run queue/Cache 抖动。

下一篇：[内存性能：带宽、延迟、局部性与回收](./05-内存性能-带宽延迟局部性与回收.md)
