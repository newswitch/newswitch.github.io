---
title: "内核时间、Clocksource、Timer 与 Hrtimer：时间从哪里来，回调何时运行"
sidebar_label: "07. 内核时间、Timer 与 Hrtimer"
sidebar_position: 7
description: "区分 wall time、monotonic time、clocksource、clockevent、tick、timer wheel 和高精度定时器。"
tags: [Linux, Timekeeping, Clocksource, Hrtimer, NO_HZ]
---

# 内核时间、Clocksource、Timer 与 Hrtimer：时间从哪里来，回调何时运行

“系统时间”至少包含计量时间、安排未来事件和人类日历三件事。NTP 调整墙上时间时，超时逻辑通常应继续依赖单调时钟。

## 1. 时钟角色

| 对象 | 作用 |
|---|---|
| clocksource | 提供连续计数，内核把 cycle 转为纳秒 |
| clockevent device | 在未来某时刻触发事件，用于 tick/定时 |
| timekeeper | 维护 realtime、monotonic、boottime 等时间基准 |
| timer wheel | 高效管理大量普通内核 timer |
| hrtimer | 提供纳秒表达和更精确到期排序 |

精度表达为纳秒不等于回调一定在纳秒级准时执行。中断延迟、CPU 睡眠、调度和回调队列都会造成实际延后。

## 2. 常见 clock

- `CLOCK_REALTIME`：墙上时间，可因校时/人工设置跳变。
- `CLOCK_MONOTONIC`：启动后单调推进，通常不含 suspend 时间。
- `CLOCK_BOOTTIME`：单调且计入 suspend，适合跨休眠时限。
- `CLOCK_MONOTONIC_RAW`：更接近未经 NTP 频率校正的硬件计数。

业务超时不应简单使用可后退的 realtime 做时间差。

## 3. Tick 与 NO_HZ

传统周期 tick 定期驱动调度和计时。NO_HZ 在空闲或特定 CPU 上减少周期 tick，降低功耗和干扰；并不代表系统不再需要 clockevent。完全 tickless 还需要任务布局和内核配置配合。

## 4. Timer 生命周期竞态

删除 timer/work 时要区分：尚未入队、已入队未运行、正在另一个 CPU 执行、回调再次 rearm。同步删除接口会等待正在执行的回调结束，但若持有回调需要的锁再等待，也会死锁。

## 5. 时间异常排查

```bash
timedatectl
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
cat /sys/devices/system/clocksource/clocksource0/available_clocksource
cat /proc/timer_list 2>/dev/null | head -80
dmesg -T | grep -Ei 'clocksource|timekeeping|tsc'
```

虚拟机时间抖动还要检查 vCPU steal、宿主机迁移和 paravirtual clock。容器共享内核时钟基础，但 Time Namespace 可为部分 clock 提供 offset，并不虚拟化所有时间来源。

## 6. 练习与答案

**问题：`sleep(1)` 是否保证恰好一秒后运行？**

答案：只保证在目标时刻前不会按正常路径返回；到期后任务还需被唤醒并获得 CPU，实际运行通常更晚。

**问题：NTP 把系统时间向前调整，基于 monotonic 的 30 秒超时会立刻到期吗？**

答案：通常不会。monotonic 不随墙上时间阶跃而跳变。

下一篇：[死锁、活锁、竞争与 Lockdep 排查](./08-死锁活锁竞争与Lockdep排查.md)
