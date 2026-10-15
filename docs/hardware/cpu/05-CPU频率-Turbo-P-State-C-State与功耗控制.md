---
title: "CPU 频率、Turbo、P-State、C-State 与功耗控制"
sidebar_label: "05. CPU 频率与功耗状态"
sidebar_position: 5
description: "解释 CPU 基准频率、动态加速、DVFS、P-State、C-State、功耗与温度限制，以及 Linux 中的观测和性能排查方法。"
tags: [CPU, Turbo, DVFS, P-State, C-State, TDP, cpufreq]
---

# CPU 频率、Turbo、P-State、C-State 与功耗控制

CPU 利用率是“有多少调度时间在执行”，不是“CPU 以多高频率、多少功率完成了多少有效工作”。相同的 80% 利用率，可能运行在高频，也可能因功率、温度或平台策略被限制在低频。

## 1. 频率从哪里来

简化理解：

```text
Core Frequency ≈ Reference Clock × Ratio
```

现代 CPU 会动态调整 Ratio 和电压，不同 Core 甚至可以处于不同活动状态。操作系统看到的某个“MHz”字段可能是请求值、采样值或估算值，不能脱离工具含义比较。

## 2. Base、Boost 与 All-core Frequency

- Base Frequency：在产品定义的功耗和条件下用于描述基线，不保证每时每刻固定运行；
- Max Boost/Turbo：满足温度、电流、功耗和活跃核心等条件时，部分核心可能达到的最高值；
- All-core Frequency：大量核心同时繁忙时可持续的频率，通常低于单核最高 Boost；
- Effective Frequency：考虑空闲周期后真正用于执行的等效频率。

不能用包装页上的最高 Turbo 频率乘以所有核心数计算持续算力。

## 3. DVFS

Dynamic Voltage and Frequency Scaling 根据负载动态调整电压和频率：

```text
更高频率
→ 通常需要更高电压
→ 动态功耗和热量快速增加
→ 受到功耗、温度和供电限制
```

近似动态功耗关系：

```text
Pdynamic ∝ C × V² × f
```

因此最后几百 MHz 可能需要不成比例的额外功率。

## 4. P-State

P-State 描述处理器的性能状态。传统 ACPI 模型中，较高性能状态对应更高频率/电压；现代平台可能使用硬件自主控制，由 OS 提供性能偏好或上下限。

Linux 常见路径：

```text
/sys/devices/system/cpu/cpu*/cpufreq/
├── scaling_driver
├── scaling_governor
├── scaling_cur_freq
├── scaling_min_freq
└── scaling_max_freq
```

不同驱动如 `intel_pstate`、`amd-pstate`、`acpi-cpufreq` 的语义不完全相同。

## 5. Governor

常见 Governor/策略：

| 策略 | 目标 | 风险 |
| --- | --- | --- |
| performance | 倾向高性能状态 | 空闲功耗与热量更高 |
| powersave | 倾向能效 | 名称不一定意味着固定最低频 |
| schedutil | 根据调度负载调整 | 依赖驱动和调度信息 |
| userspace | 由用户空间控制 | 现代平台未必支持完整控制 |

选择策略要用延迟、吞吐、功耗和温度共同验收。

## 6. C-State

C-State 描述 Idle 状态：

- C0：核心正在执行；
- C1 及更深状态：关闭更多时钟或电源域以节能；
- 状态越深，通常节能越多，唤醒延迟也可能越大。

Package C-State 还反映整个封装的空闲程度。即使某个核心空闲，其他核心、设备中断或内存活动也可能阻止 Package 进入深度状态。

## 7. P-State 与 C-State 的区别

```text
P-State：CPU 工作时，以什么性能/功耗水平工作
C-State：CPU 没有工作时，进入多深的空闲状态
```

一个核心可以频繁在 C0 和深 C-State 间切换，同时在 C0 阶段使用不同 P-State。

## 8. TDP、功耗上限与真实功耗

TDP 主要服务产品和散热设计，不等于：

- CPU 永远只消耗这个功率；
- 整台服务器的功率；
- 短时峰值功率；
- 所有指令下的固定功率。

平台可能存在多组限制：

- 长时间平均功耗限制；
- 短时间加速功耗限制；
- 电流和 VRM 限制；
- 温度限制；
- BIOS/OEM Power Profile；
- 机柜或 BMC Power Cap。

## 9. 为什么向量指令可能降频

宽向量或矩阵单元在单位时间切换大量晶体管，功耗密度较高。某些 CPU 会根据指令类型、活跃核心和温度选择较低频率。

所以：

```text
使用 AVX/矩阵指令
→ 每周期完成更多工作
→ 频率可能下降
→ 总吞吐仍可能上升
```

不能只看 MHz 判断优化是否有效。

## 10. Thermal、Power 与 Current Throttling

常见限制来源：

| 限制 | 原因 | 证据方向 |
| --- | --- | --- |
| Thermal | 核心、封装、VRM 或进风温度高 | 温度、风扇、Thermal Status |
| Power | 达到 Package/平台功耗上限 | RAPL/BMC Power、Power Limit |
| Current/EDP | 瞬时电流或供电设计限制 | VRM、Electrical Design Point |
| Reliability | 硬件保护或错误策略 | MCA、Firmware、BMC SEL |
| Policy | BIOS/OS 设置保守 | Power Profile、Governor、Cap |

散热良好也可能因功率上限降频；功率未满也可能因局部热点降频。

## 11. 观测方法

```bash
lscpu
cpupower frequency-info
cpupower idle-info
turbostat --Summary --interval 1
perf stat -a -e cycles,instructions,ref-cycles sleep 10
grep . /sys/devices/system/cpu/cpu0/cpufreq/*
sensors
ipmitool sdr type temperature
```

重点关联：

- Busy% 与 IPC；
- Average MHz 与 Busy MHz；
- C-State Residency；
- Package Power；
- Core/Package Temperature；
- Thermal/Power Limit 标志；
- 调度、IRQ 和 NUMA 位置。

## 12. 容器中的 CPU 限制

cgroup CPU Limit 控制可用调度时间，不直接把物理核心固定到某个频率：

```text
CPU Quota
→ 进程可运行时间受限
→ 可能发生 Throttling

cpufreq / Power Policy
→ 物理 CPU 运行频率和能效策略
```

容器 `CPU Utilization=100%` 可能只是用满自身配额，而宿主机 Core 仍未满；也可能同时遭受 CFS Throttling 和硬件降频。

## 13. 低延迟与能效调优

低延迟场景可能需要：

- 避免过深 Idle State；
- 使用合适的性能偏好；
- 固定 IRQ/线程亲和性；
- 保持 NUMA Local；
- 预留散热和功耗余量。

批处理和离线任务通常更看重每瓦吞吐，可以允许更深 Idle State 和更积极的 DVFS。

## 14. 排障流程

```text
吞吐下降/P99 上升
→ 确认 CPU 配额与 Run Queue
→ 查看 IPC、Busy MHz、Effective Frequency
→ 检查 C-State 和唤醒模式
→ 检查 Package Power 与温度
→ 检查 Thermal/Power/Current Limit
→ 对照 BIOS、BMC Power Cap 和最近变更
```

不能通过“关闭所有节能功能”代替定位，它可能掩盖散热、调度和电源问题。

## 15. 练习与答案

**问题：CPU 利用率 40%，频率却很低，是否一定异常？**

答案：不一定。负载可能间歇运行、等待内存/I/O，工具显示的可能是有效频率；也可能是 Power Policy、温度或功率限制。需要联合 IPC、Busy MHz、C-State 和功耗判断。

**问题：把 Governor 改成 performance 是否一定降低 P99？**

答案：不一定。P99 也可能来自锁、NUMA、存储、网络、GC 或配额；高频还可能提高温度并触发更强的功率限制，必须用业务指标验证。

## 16. 参考资料

- [Linux Kernel：CPU Performance Scaling](https://docs.kernel.org/admin-guide/pm/cpufreq.html)
- [Linux Kernel：CPU Idle Time Management](https://docs.kernel.org/admin-guide/pm/cpuidle.html)
- [Linux Kernel：Intel P-state Control](https://docs.kernel.org/admin-guide/pm/intel_pstate.html)
