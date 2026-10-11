---
title: "CFS、EEVDF 与实时调度：Linux 如何选择下一个任务"
sidebar_label: "07. CFS、EEVDF 与实时调度"
sidebar_position: 7
description: "解释调度类、nice 权重、CFS 虚拟运行时间、EEVDF lag/虚拟截止时间和实时调度风险。"
tags: [Linux, Scheduler, CFS, EEVDF, SCHED_FIFO]
---

# CFS、EEVDF 与实时调度：Linux 如何选择下一个任务

Linux 没有用一个算法处理所有任务。调度类先决定不同策略之间的优先关系，每个调度类再维护自己的可运行任务和选取规则。

## 1. 调度类框架

常见策略：

| 用户策略 | 目标 | 关键参数 |
|---|---|---|
| `SCHED_OTHER`/NORMAL | 普通公平调度 | nice/权重 |
| `SCHED_BATCH` | 批处理，降低交互抢占倾向 | nice/权重 |
| `SCHED_IDLE` | 极低优先级后台工作 | 策略本身 |
| `SCHED_FIFO` | 固定优先级实时任务 | RT priority |
| `SCHED_RR` | 带时间片轮转的实时任务 | RT priority |
| `SCHED_DEADLINE` | 基于 runtime/deadline/period 的截止期任务 | 带宽参数 |

高调度优先级不等于业务优先级。配置错误的实时线程可以使 SSH、监控甚至关键内核工作得不到 CPU。

## 2. CFS 的核心思想

传统 CFS 用虚拟运行时间 `vruntime` 近似衡量任务获得的加权 CPU 份额。nice 值影响权重：权重高的任务实际运行同样时间时，虚拟时间增长较慢，因此更容易再次获得 CPU。

简化理解：

```text
vruntime 增量 ≈ 实际运行时间 × 基准权重 / 任务权重
```

CFS 历史实现用按 `vruntime` 排序的结构选择更“欠 CPU”的任务。真实实现还要处理唤醒、抢占、组调度、负载均衡和多核。

## 3. EEVDF 改变了什么

Linux 6.6 开始向 EEVDF 公平调度选择逻辑过渡。它仍追求同权重任务的公平份额，但引入两个关键概念：

- `lag`：任务相对理想公平服务是欠了 CPU，还是已经多用了 CPU。
- Virtual Deadline：结合请求服务量计算的虚拟截止时间。

调度器先考虑符合 eligible 条件的任务，再从中选择虚拟截止时间更早者。这样能在保持长期公平的同时，更好表达短时间片任务的响应需求。

不能把 EEVDF 理解成“所有普通任务变成实时截止期调度”。它仍属于公平调度类，与 `SCHED_DEADLINE` 的 admission control 和参数语义不同。

### 3.1 从公平服务量推导 eligible

取单 CPU、固定可运行集合的教学模型，任务 i 的权重为 w_i，已获得的虚拟服务为 v_i。把基准权重归一化为 1，则运行真实时间 Δt 后 `Δv_i=Δt/w_i`。队列虚拟时间与服务欠账可写为：

```text
V = sum_i(w_i v_i) / sum_i(w_i)
lag_i = w_i(V-v_i)
eligible：lag_i ≥ 0，即 v_i ≤ V
请求实际服务量 q_i 的虚拟长度 = q_i/w_i
虚拟 deadline d_i = 请求起点的虚拟时间 + q_i/w_i
```

这里的 lag 是相对公平份额的欠账，不是请求等待了多少墙钟毫秒。真实 Linux 还处理实体入队/出队、层级 cgroup、整数精度、Lag 限制和抢占；本文用固定集合隔离核心选择机制。[Linux v6.12 fair.c](https://github.com/torvalds/linux/blob/v6.12/kernel/sched/fair.c)中的虚拟时间、eligible 与 deadline 逻辑可以对应到这个模型，不能把简化式当成完整实现。

### 3.2 为什么最早 deadline 也可能不能运行

三个同权重任务 A/B/C 当前虚拟服务分别是 4/4/7，故 V=5，Lag 分别为 1/1/-2。当前请求起点取上述 v，请求长度为 5/6/0.5，deadline 为 9/10/7.5。C 的 deadline 最早，却已经超额获得 CPU，不 eligible；应从 A/B 中选 A。

A 运行 1 个时间单位后，v 变成 `[5,4,7]`，V=16/3。A 的本次请求 deadline 仍为 9，不是在每个时刻都用“新 v+完整请求长度”重新往后推；已消耗服务减少的是该请求剩余量。运行至请求完成或满足相应抢占条件时，选择再按新的状态进行。

短请求可以使 deadline 更近，但仍受 eligible 约束。若只选最小 vruntime，无法表达请求长度；若只选最早 deadline，超额服务的任务可能继续抢占。EEVDF 将公平准入与延迟选择分成两个条件。[内核 EEVDF 文档](https://docs.kernel.org/scheduler/sched-eevdf.html)说明了这一区别。

### 3.3 睡眠和权重不是免费重置按钮

任务睡眠后重新唤醒，不能无限通过重新入队抹掉负 Lag，否则可以反复短睡眠占用超额 CPU。Linux 的 Lag 保留、衰减与延迟出队行为随版本变化，需固定源码基线；上述固定集合模型没有模拟这些规则。权重加倍也不是提高调度类优先级：它改变长期份额与虚拟时间增长，不保证每个时刻都先运行，更不绕过 cgroup 配额或 CPU 亲和性。

## 4. nice 不是 CPU 百分比

nice 范围通常为 -20 到 19，改变的是同一竞争域内普通任务的相对权重：

- 没有竞争时，nice 19 的任务仍可使用整个空闲 CPU。
- nice 0 与 nice 5 不是固定的 50%/25%。
- cgroup CPU weight、任务 nice、CPU 数量和其他调度类共同影响结果。

## 5. 实时调度为什么危险

`SCHED_FIFO` 任务在没有阻塞、主动让出或被更高 RT 优先级任务抢占时可以持续运行。`SCHED_RR` 只在同优先级任务之间增加轮转时间片。内核通常提供 RT bandwidth 限制以保留恢复机会，但不能依赖它弥补错误设计。

```bash
chrt -p <PID>
ps -eLo pid,tid,cls,rtprio,pri,ni,psr,stat,comm
sysctl kernel.sched_rt_runtime_us kernel.sched_rt_period_us
```

不要在共享生产节点上随意把任务改为实时策略。实时调度解决最坏响应约束，不是普通服务“加速开关”。

## 6. 多核上的调度

每个 CPU 有自己的运行队列，减少全局锁争用。内核还要在以下目标间权衡：

- 公平使用 CPU。
- 保持 Cache 热度，减少迁移。
- 遵守 CPU affinity 和 cpuset。
- 处理 NUMA 局部性。
- 让空闲 CPU 接走过载 CPU 的任务。
- 满足实时和截止期约束。

所以“系统有空闲 CPU”不代表某个受限任务能迁移过去。

## 7. 如何验证调度问题

```bash
ps -eLo pid,tid,psr,cls,rtprio,pri,ni,stat,comm
cat /proc/<PID>/sched
cat /proc/pressure/cpu
perf sched record -- sleep 10
perf sched timehist
```

采集调度事件本身有开销，高频生产环境应缩短窗口、限定目标，并先确认数据合规和磁盘空间。

## 8. 版本边界

不能把旧文章中的 CFS 红黑树细节原样套用到所有 6.x 内核。固定源码基线，并确认发行版是否回移了调度器补丁。用户可见策略名称可能不变，内部公平选择逻辑已经演化。

## 9. 练习与答案

**问题：把服务 nice 从 0 调到 -10，是否一定降低延迟？**

答案：不一定。只有存在同调度类 CPU 竞争且调用者有权限时才可能改变份额；若瓶颈是锁、IO、cgroup 配额或单线程串行，nice 不能解决。

**问题：EEVDF 和 SCHED_DEADLINE 是否同一种调度？**

答案：不是。EEVDF 用虚拟截止时间改善普通公平调度选择；SCHED_DEADLINE 是独立调度策略，任务声明 runtime/deadline/period 并受带宽准入约束。

下一篇：[SMP、CPU 亲和性与 cgroup CPU](./08-SMP亲和性与cgroup-CPU.md)
