---
title: "Softirq、Tasklet、NAPI 与 Workqueue：中断之后谁完成剩余工作"
sidebar_label: "02. Softirq、NAPI 与 Workqueue"
sidebar_position: 2
description: "解释 Linux 延后执行机制的上下文、并发、睡眠限制及高负载下 ksoftirqd 和工作队列行为。"
tags: [Linux, Softirq, NAPI, Workqueue, ksoftirqd]
---

# Softirq、Tasklet、NAPI 与 Workqueue：中断之后谁完成剩余工作

硬中断处理必须短，否则当前 CPU 长时间无法正常调度并会推高系统抖动。Linux 把大量可延后的工作转交给 softirq 或工作队列。

## 1. 机制对比

| 机制 | 执行上下文 | 能否睡眠 | 典型用途 |
|---|---|---|---|
| hardirq handler | 中断上下文 | 不能 | 确认设备、取 completion、安排后续 |
| softirq | 中断/`ksoftirqd` | 不能 | 网络、timer、RCU 等高频工作 |
| tasklet | 基于 softirq 的旧接口 | 不能 | 旧驱动延后工作；新代码通常不首选 |
| workqueue | 内核工作线程 | 可以 | 需要阻塞、分配或较长时间的处理 |
| threaded IRQ | 专用/共享内核线程 | 可以 | 适合线程化的设备中断处理 |

“延后执行”不等于“稍后仍在同一上下文”。是否能睡眠决定可以使用的锁和 API。

## 2. Softirq 的运行机会

Softirq 可在中断退出、显式调用处理点或 `ksoftirqd/N` 内执行。若预算/时间限制内处理不完，剩余工作由对应 CPU 的 `ksoftirqd` 接管，避免无限占用内核返回路径。

```bash
cat /proc/softirqs
ps -eLo pid,tid,psr,comm | grep ksoftirqd
mpstat -P ALL 1
```

`si` 高表示 CPU 花在软件中断上的时间增加；它不能直接说明是哪种 softirq，必须结合每类计数和设备队列。

## 3. NAPI 是中断与轮询的混合

网卡低流量时通过 IRQ 快速通知，高流量时驱动安排 NAPI poll 并暂时减少同队列中断：

```text
IRQ 通知 RX queue
→ schedule NAPI
→ poll(budget) 批量回收 descriptor
→ 未清空：继续调度
→ 已清空：complete NAPI 并重新允许通知
```

这避免每个包一次硬中断，但若 budget、队列、CPU affinity 或应用处理不合理，可能出现单核 `NET_RX` 热点、`softnet_stat` drop/time_squeeze 增长。

## 4. Workqueue 的并发边界

Workqueue 把 `work_struct` 交给 worker pool。常见选择包括绑定/非绑定、普通/高优先级、可回收等属性。错误设计包括：

- 同一 work 尚未完成又依赖自己再次执行。
- flush/cancel 与持锁顺序构成死锁。
- 把无限阻塞任务放进共享队列，耗尽 worker。
- teardown 时先释放对象，后取消 work，形成 use-after-free。

正确注销通常遵循：停止产生新事件 → 屏蔽设备/取消 timer → 同步等待正在运行的 IRQ/work → 释放对象。

## 5. 现场定位

```bash
grep -E 'NET_RX|NET_TX|BLOCK|TIMER|RCU' /proc/softirqs
cat /proc/net/softnet_stat
perf top -a
perf record -a -g -- sleep 10
```

看到 `ksoftirqd` 占 CPU 不是根因描述。要继续回答：哪一类 softirq、由哪个设备/队列触发、每秒事件量、是否存在 drop、为何不能在预算内处理完。

## 6. 练习与答案

**问题：为什么 softirq 中不能获取 mutex？**

答案：mutex 竞争时可能睡眠，而 softirq 不是可调度的进程上下文。应使用适合中断上下文的同步方式，或把工作移到 workqueue。

**问题：把所有网络处理都移到 workqueue 是否更好？**

答案：不是。线程调度和上下文切换也有成本；NAPI/softirq 为高频批处理设计，应先解决队列、亲和性和负载分布问题。

下一篇：[内核抢占、临界区与执行上下文](./03-内核抢占临界区与执行上下文.md)
