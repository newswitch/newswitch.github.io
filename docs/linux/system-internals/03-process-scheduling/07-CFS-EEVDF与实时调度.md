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
