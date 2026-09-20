---
title: "USE、RED、饱和与压力指标：从资源和请求两个方向检查系统"
sidebar_label: "03. USE、RED 与压力指标"
sidebar_position: 3
description: "解释 Utilization/Saturation/Errors、Rate/Errors/Duration、PSI 与资源队列，避免机械阈值。"
tags: [Linux, USE Method, RED Method, PSI, Saturation]
---

# USE、RED、饱和与压力指标：从资源和请求两个方向检查系统

USE 从资源出发，RED 从服务请求出发。两者是覆盖清单，不是根因算法；最终仍需把请求阶段映射到具体资源和队列。

## 1. USE

| 维度 | 问题 |
|---|---|
| Utilization | 资源忙于工作的时间/容量比例 |
| Saturation | 超出立即服务能力而排队/节流的程度 |
| Errors | 请求或设备错误计数 |

CPU 的 saturation 可看 run queue、调度延迟、cgroup throttle；内存没有简单 `%util`，更应看回收、major fault、Swap 和 PSI；磁盘要看队列与延迟而非只看 `%util`。

## 2. RED

- Rate：请求到达/完成速率。
- Errors：按失败类型和阶段分类。
- Duration：完整延迟分布。

入口成功率正常但下游 retry 激增，可能掩盖真实错误并放大负载；duration 要分排队、执行和依赖阶段。

## 3. PSI

PSI 统计任务因 CPU、内存或 IO 无法前进的时间。它比单纯使用率更接近用户等待，但仍不告诉具体对象和调用栈。

```bash
cat /proc/pressure/{cpu,memory,io}
cat /sys/fs/cgroup/<path>/{cpu,memory,io}.pressure
```

CPU 只有 `some`；memory/io 的 `full` 表示所有 non-idle task 同时 stall。`avg10/60/300` 是时间窗平均，`total` 是累计微秒。

## 4. 局部饱和

系统总体空闲时仍可出现：

- 单核/IRQ queue 饱和。
- 单个 cgroup quota 用尽。
- 单块盘 hardware queue 或单 shard 饱和。
- connection pool/thread pool 满。
- NUMA 本地内存带宽或互连拥塞。

所有指标都要保持 scope：host、cgroup、device、queue、process。

## 5. 练习与答案

**问题：磁盘 `%util=100` 是否一定没有继续提升吞吐空间？**

答案：不一定。多队列设备可同时处理多个请求，传统 `%util` 表示采样期有 IO 在途，不等同内部所有通道满；需结合吞吐、await、队列和设备能力。

**问题：PSI 高能否直接定位代码函数？**

答案：不能。它说明资源等待时间，需要用栈、trace 和子系统指标继续定位等待者与资源。

下一篇：[CPU 性能：利用率之外的瓶颈](./04-CPU性能-利用率之外的瓶颈.md)
