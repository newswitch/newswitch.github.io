---
title: "死锁、活锁、竞争与 Lockdep：并发故障如何形成证据链"
sidebar_label: "08. 死锁、活锁、竞争与 Lockdep"
sidebar_position: 8
description: "区分 deadlock、livelock、starvation、race，使用 SysRq、栈、lockdep、lockstat 和 trace 构造证据。"
tags: [Linux, Deadlock, Lockdep, Race, Lockstat]
---

# 死锁、活锁、竞争与 Lockdep：并发故障如何形成证据链

“进程卡住”可能是在正常等待 IO，也可能是锁环、事件丢失、CPU 饥饿或反复重试。先识别等待关系，再决定是否属于死锁。

## 1. 四类问题

| 问题 | 特征 |
|---|---|
| Deadlock | 参与者形成不可打破的等待环，进度为零 |
| Livelock | 持续执行/重试，但有效进度为零 |
| Starvation | 某参与者长期得不到 CPU、锁或资源 |
| Race | 结果依赖并发时序，可能偶发错误而非停住 |

## 2. 现场先保留什么

```bash
date --iso-8601=ns
uptime
ps -eLo pid,tid,psr,stat,wchan:32,comm
cat /proc/locks
cat /proc/interrupts
cat /proc/softirqs
```

系统尚能响应且已配置 SysRq 时，可在受控环境获取 blocked tasks 或全部任务栈；生产使用前要确认输出量、串口/日志承载和安全策略。不要先重启再猜。

## 3. Lockdep 能发现什么

开启 `CONFIG_PROVE_LOCKING` 等调试配置后，lockdep 跟踪锁类别与获取顺序，可发现潜在 ABBA 顺序、错误 IRQ 上下文和递归获取。它证明“观察到的锁依赖可能形成问题”，不覆盖没有标注的自定义协议，也不能代替业务级等待分析。

```bash
dmesg -T | grep -Ei 'possible circular locking|lockdep|held lock'
```

调试配置有明显性能/内存成本，通常在测试内核复现。

## 4. 竞争热点

锁没有死锁也可能导致长尾：许多 CPU 在同一 Cache line 或自旋锁上竞争。可结合 `perf lock`、lockstat（内核配置允许时）、off-CPU 栈和函数采样定位；先确认采集工具自身开销。

```bash
perf lock record -- <workload>
perf lock report
perf record -a -g -- sleep 10
```

## 5. 排查闭环

1. 固定故障时间窗与受影响线程。
2. 判断线程是 runnable、sleep、D 状态还是反复运行。
3. 从栈中的等待函数定位锁、completion、IO 或调度点。
4. 找资源 owner 及 owner 又在等待谁。
5. 画 wait-for graph，检查是否成环或缺少唤醒。
6. 用 trace/调试内核复现顺序。
7. 修复所有权、锁序或生命周期并做压力回归。

## 6. 不安全的“修复”

- 任意删除锁，只因“竞争高”。
- 调大 watchdog/RCU stall 阈值隐藏停顿。
- 周期性重启释放现场。
- 把阻塞改为无限自旋。

这些可能改变症状，却没有恢复并发不变量。

## 7. 练习与答案

**问题：线程全部处于 `D` 状态，能否断定内核死锁？**

答案：不能。`D` 表示不可中断睡眠，常见于 IO；要看 `wchan`、栈、设备完成和等待图，判断是慢、丢完成还是锁环。

**问题：lockdep 没报警能否证明没有并发问题？**

答案：不能。配置可能未启用，路径可能未覆盖，问题也可能是无锁 race、引用生命周期或业务级事件丢失。

下一模块：[设备模型与驱动导读](../09-devices-drivers/00-设备模型与驱动导读.md)
