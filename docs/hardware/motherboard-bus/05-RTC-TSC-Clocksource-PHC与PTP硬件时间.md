---
title: "RTC、TSC、Clocksource、PHC 与 PTP 硬件时间"
sidebar_label: "05. 硬件时钟与时间同步"
sidebar_position: 5
description: "解释服务器振荡器、RTC、TSC、Clocksource、Clockevent、NIC PHC、硬件时间戳与 PTP，建立时间漂移和跳变排障路径。"
tags: [RTC, TSC, Clocksource, PHC, PTP, 时间同步]
---

# RTC、TSC、Clocksource、PHC 与 PTP 硬件时间

服务器里同时存在多种“时间”：主板 RTC 保存关机时间，CPU Counter 为内核提供高分辨率计时，NIC PHC 为 PTP 提供硬件时间戳，系统时钟则由内核持续校准。它们不同步时，会表现为日志乱序、证书异常、分布式事务错误或训练节点时间漂移。

## 1. 时间系统的层次

```text
物理振荡器
→ Hardware Counter：RTC / TSC / HPET / PHC
→ Kernel Clocksource / Clockevent
→ System Clock：CLOCK_REALTIME / CLOCK_MONOTONIC
→ NTP/PTP 调整
→ Application Timestamp
```

时间同步不是简单地“每分钟改一下系统时间”。

## 2. Oscillator

硬件计时从振荡器开始。振荡器会受到：

- 初始频率误差；
- 温度；
- 老化；
- 电压；
- 机械应力。

影响，因此两个完全不通信的时钟会逐渐产生 Offset 和 Frequency Drift。

## 3. RTC

Real-Time Clock 由主板低功耗时钟和后备电池维持，用于关机后保留日期时间。启动时：

```text
Firmware/Kernel 读取 RTC
→ 初始化 System Clock
→ NTP/PTP 再校准
```

RTC 精度通常不适合高精度运行期计时。电池失效可能导致断电后时间复位、BIOS 配置丢失或启动告警。

```bash
timedatectl
hwclock --show
cat /proc/driver/rtc
```

## 4. TSC

Time Stamp Counter 是 CPU 提供的高分辨率计数器。现代服务器常具备 Constant/Invariant TSC，使计数频率不随普通 P-State 改变。

但仍需确认：

- 多 Socket/多 Core 是否同步；
- 虚拟机迁移时是否连续；
- Suspend/Resume 行为；
- Firmware 是否正确声明；
- 内核是否将其评为 Stable Clocksource。

TSC 是计数基础，不等同 UTC 时间。

## 5. Clocksource

Clocksource 是内核读取“经过多少时间”的硬件来源，候选可能包括：

- TSC；
- HPET；
- ACPI PM Timer；
- 架构 Generic Timer；
- Hypervisor 提供的 Paravirtual Clock。

```bash
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
cat /sys/devices/system/clocksource/clocksource0/available_clocksource
dmesg | grep -Ei 'clocksource|tsc|hpet'
```

内核发现 Clocksource 不稳定时可能切换，导致性能开销或时间异常告警。

## 6. Clockevent

Clocksource 用来读时间，Clockevent 用来安排未来某时触发事件，例如调度 Tick 和 Timer。常见来源包括 Local APIC Timer、架构 Timer 和 HPET。

```text
Clocksource：现在几点/过了多久
Clockevent：多久后叫醒 CPU
```

两者不要混淆。

## 7. 系统时钟语义

| 时钟 | 语义 | 是否可能因校时跳变 |
| --- | --- | --- |
| CLOCK_REALTIME | 日历/UTC 时间 | 可能 |
| CLOCK_MONOTONIC | 单调运行时间 | 通常不随手工改时间倒退 |
| CLOCK_BOOTTIME | 包含 Suspend 的单调时间 | 适合运行时长 |
| CLOCK_TAI | 原子时标相关 | 依赖系统配置 |

测量请求耗时应使用 Monotonic Clock，而不是直接相减两个 Wall Clock 时间戳。

## 8. NTP

NTP/chrony 通过网络参考源估计 Offset、Delay 和 Frequency Error，并逐步校正系统时钟。它适合大多数日志、业务和集群时间同步。

```bash
chronyc tracking
chronyc sources -v
timedatectl timesync-status
```

NTP 精度受网络不对称、排队、软件时间戳和参考源质量影响。

## 9. PHC

PTP Hardware Clock 通常位于 NIC 或专用时间卡上，Linux 暴露为：

```text
/dev/ptp0
/dev/ptp1
```

PHC 靠近报文收发位置，可以配合硬件时间戳减少内核调度和队列引入的不确定性。

```bash
ethtool -T eth0
ls -l /dev/ptp*
phc_ctl /dev/ptp0 get
```

## 10. PTP

Precision Time Protocol 在网络中交换时间消息，估算时钟 Offset 与路径 Delay。常见角色包括 Grandmaster、Boundary Clock、Transparent Clock 和普通时钟。

典型 Linux 链路：

```text
Grandmaster
→ PTP-aware Network
→ NIC Hardware Timestamp
→ PHC
→ phc2sys
→ System Clock
```

`ptp4l` 常用于同步 PHC，`phc2sys` 用于同步 PHC 与系统时钟。方向配置错误会把好时钟校坏。

## 11. 软件与硬件时间戳

- Application Timestamp：离业务最近，但受排队和调度影响；
- Kernel Software Timestamp：位于协议栈；
- NIC Hardware Timestamp：靠近线缆收发位置，抖动较低。

高精度同步还要求交换机和链路路径对称。只有端点支持硬件时间戳，不代表整个网络都能达到亚微秒精度。

## 12. 虚拟化和容器

容器共享 Host Kernel Clock，通常不能独立改变时间。VM 可能使用 Paravirtual Clock，并面临：

- vCPU Pause/Steal；
- Live Migration；
- Host TSC 差异；
- Hypervisor Timekeeping Bug；
- Nested Virtualization。

高精度 PTP VM 可能需要把 PHC、VF 或 Hardware Timestamp 能力安全暴露给 Guest。

## 13. 常见故障

| 现象 | 可能原因 |
| --- | --- |
| 重启后时间回到过去 | RTC 电池、RTC/UTC 配置 |
| 单节点持续漂移 | NTP 源、网络、防火墙、振荡器 |
| PTP Offset 抖动大 | 软件时间戳、排队、不对称路径 |
| 日志时间倒退 | Step 校时、VM 时钟、Clocksource |
| TLS 证书突然无效 | System Clock 错误 |
| 多 Socket 基准异常 | TSC/Clocksource 不稳定或线程迁移 |

## 14. 排障顺序

1. 确认应用使用 Wall Clock 还是 Monotonic；
2. 检查当前 Clocksource 和内核告警；
3. 检查 RTC、System Clock、时区和 Leap 信息；
4. 检查 NTP/PTP Source、Offset、Delay 和 Frequency；
5. 验证 NIC Hardware Timestamp 和 PHC 映射；
6. 检查交换机 PTP Profile、Boundary/Transparent Clock；
7. 关联 VM Migration、Suspend、Firmware 和网络变更。

## 15. 练习与答案

**问题：服务器 NTP 显示已同步，是否说明两块 NIC PHC 也已同步？**

答案：不一定。NTP 通常校准 System Clock；PHC 需要 PTP 或显式的 PHC-System 同步。必须检查每个 `/dev/ptpX` 和同步方向。

**问题：为什么计算请求耗时应使用 Monotonic Clock？**

答案：Wall Clock 可能因 NTP Step、手工改时或时区处理发生跳变；Monotonic Clock 用于测量经过时间，不应随日历时间调整倒退。

## 16. 参考资料

- [IEEE：IEEE 1588-2019](https://standards.ieee.org/ieee/1588/6825/)
- [Linux PTP Project](https://linuxptp.nwtime.org/)
- [Linux Kernel：PTP Hardware Clock Infrastructure](https://docs.kernel.org/driver-api/ptp.html)
