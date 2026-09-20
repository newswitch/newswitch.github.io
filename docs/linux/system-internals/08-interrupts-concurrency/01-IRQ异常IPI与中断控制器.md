---
title: "IRQ、异常、IPI 与中断控制器：CPU 为什么会暂停当前工作"
sidebar_label: "01. IRQ、异常、IPI 与中断控制器"
sidebar_position: 1
description: "区分外部中断、同步异常和核间中断，理解中断向量、APIC/GIC、MSI-X、亲和性与硬中断路径。"
tags: [Linux, IRQ, Exception, IPI, MSI-X]
---

# IRQ、异常、IPI 与中断控制器：CPU 为什么会暂停当前工作

CPU 进入内核不只有系统调用。设备完成、定时器到期、页表缺失、非法指令和另一个 CPU 的请求，都可能改变当前控制流。

## 1. 三类入口

| 类型 | 是否与当前指令同步 | 例子 |
|---|---|---|
| 外部硬件中断 IRQ | 否 | NIC 收包、NVMe completion、定时器 |
| 异常 Exception | 是 | 缺页、除零、通用保护异常 |
| 核间中断 IPI | 否，由其他 CPU 发起 | 调度唤醒、TLB shootdown、停止 CPU |

系统调用是软件主动进入内核的受控入口。异常不都代表错误：按需分配和 Copy-on-Write 正是借助缺页异常完成。

## 2. 从设备到处理函数

```text
设备产生传统引脚中断或写入 MSI/MSI-X message
→ 中断控制器路由到目标 CPU
→ CPU 保存最小现场并按向量进入架构入口
→ Linux irq_desc / irq_domain 找到逻辑 IRQ
→ 通用 IRQ 层调用注册的 handler
→ 确认设备状态、清除/屏蔽中断源、安排延后工作
→ irq_exit，必要时处理 softirq，再返回原上下文
```

MSI/MSI-X 本质上是设备向特定地址写入消息。MSI-X 能为多个队列提供独立向量，便于把 RX/TX 或 NVMe 队列分散到不同 CPU。

## 3. IRQ number 不等于硬件固定引脚

Linux 使用逻辑 IRQ 编号，`irq_domain` 把固件/控制器中的硬件中断号映射到内核编号。虚拟机、级联控制器和 Device Tree 系统中尤其不能把 `/proc/interrupts` 第一列直接当物理引脚。

## 4. 亲和性与局部性

```bash
cat /proc/interrupts
cat /proc/irq/<IRQ>/smp_affinity_list
cat /proc/irq/<IRQ>/effective_affinity_list
```

配置亲和性是期望集合，`effective_affinity_list` 才是当前生效结果。IRQ 应尽量靠近设备所在 NUMA Node 和处理数据的线程，但也要避免所有高频向量堆在一个 CPU。`irqbalance`、驱动和内核可能重新分配。

## 5. 共享中断与虚假中断

传统 INTx 可能由多个设备共享，handler 要读取设备状态判断中断是否属于自己。MSI-X 通常不共享，但仍需正确处理设备在屏蔽、复位和 teardown 期间的竞态。

## 6. IPI 为什么昂贵

修改跨 CPU 共享状态时，内核可能要求其他 CPU 执行回调。例如撤销页表映射需要 TLB shootdown：

```text
CPU0 修改页表
→ 向使用该 mm 的 CPU 发送 IPI
→ 目标 CPU 清理对应 TLB 项并确认
→ CPU0 才能安全复用页面
```

频繁 `munmap`、迁移页或修改保护属性，可能把成本放大为跨核同步等待。

## 7. 观测与判断

```bash
grep -E 'CPU|LOC|RES|CAL|TLB|NMI' /proc/interrupts
cat /proc/softirqs
mpstat -P ALL 1
perf stat -a -e irq:irq_handler_entry,irq:irq_handler_exit -- sleep 10
```

- 单个 IRQ 计数集中：检查队列数、MSI-X、亲和性和 RSS。
- IRQ 不高但 `NET_RX` 高：工作已进入软中断阶段。
- `/proc/interrupts` 不增长：可能设备没发中断、向量未启用、驱动轮询或观察了错误 Namespace/主机。

## 8. 练习与答案

**问题：网卡有 32 个 RX 队列，是否必然有 32 个 CPU 同时处理？**

答案：不必然。还取决于 MSI-X 向量数量、队列到向量映射、IRQ affinity、RSS indirection table、流数量和驱动配置。

**问题：缺页异常为什么不属于外部 IRQ？**

答案：它由当前指令访问无法完成而同步触发；修复映射后通常重试同一指令。

下一篇：[Softirq、Tasklet、NAPI 与 Workqueue](./02-Softirq-Tasklet-NAPI与Workqueue.md)
