---
title: "CPU 硬件原理从零到精通学习路线"
sidebar_label: "00. CPU 硬件学习路线"
sidebar_position: 0
description: "从流水线、乱序执行和分支预测，到 Cache、TLB、一致性、Socket 互联与 NUMA 的 CPU 硬件学习路线。"
tags: [CPU, 微架构, Cache, TLB, MESI, NUMA]
---

# CPU 硬件原理从零到精通学习路线

CPU 利用率只表示调度器观察到线程在运行，不表示每个周期都完成了有效指令。前端断供、分支错误、Cache Miss、内存等待、锁竞争和远端 NUMA 都可能让“忙碌的 CPU”实际效率很低。

## 1. 学习顺序

1. [CPU 流水线、乱序执行与分支预测](./01-CPU流水线乱序执行与分支预测.md)
2. [Cache、Cache Line、TLB 与 MESI 一致性](./02-Cache-CacheLine-TLB与MESI一致性.md)
3. [Socket、IMC、UPI、xGMI 与 NUMA](./03-Socket-IMC-UPI-xGMI与NUMA.md)
4. [Linux 进程、线程与 task_struct](../../linux/system-internals/03-process-scheduling/01-进程线程与task_struct.md)
5. [上下文切换与调度延迟](../../linux/system-internals/03-process-scheduling/06-上下文切换与调度延迟.md)
6. [CPU 性能：利用率之外的瓶颈](../../linux/system-internals/13-performance-reliability/04-CPU性能-利用率之外的瓶颈.md)

前三篇解释硬件怎样执行，后三篇解释 Linux 怎样调度和观测。两者合起来才能判断问题来自应用、调度器还是微架构。

## 2. 从 ISA 到微架构

- ISA：软件可见的指令、寄存器、内存和异常约定，例如 x86-64、AArch64；
- Microarchitecture：某款 CPU 怎样用 Pipeline、Execution Port、Cache 和 Predictor 实现 ISA；
- Core：一套主要执行资源；
- SMT Thread：共享一个 Core 部分资源的硬件线程；
- Socket：一个物理 CPU 封装及其内存、I/O 和互联资源。

相同 ISA 的两代 CPU 可以运行同一程序，但 IPC、Cache、内存和功耗特征完全不同。

## 3. 性能基本式

```text
执行时间 ≈ 指令数 × 每指令平均周期（CPI）÷ 时钟频率
IPC = 每周期完成指令数 = 1 / CPI（简化理解）
```

提高频率只能缩短每个 Cycle，不能消除 Cache Miss、分支错误和串行依赖。比较 CPU 时应同时观察指令数、IPC、频率和等待原因。

## 4. 三类并行

| 并行类型 | 实现 | 限制 |
| --- | --- | --- |
| 指令级并行 | 超标量、乱序执行 | 数据依赖、分支、执行端口 |
| 数据级并行 | SIMD/Vector | 数据布局、指令集、内存带宽 |
| 线程级并行 | 多 Core、SMT、多 Socket | 锁、NUMA、共享 Cache |

更多线程不一定更快。内存带宽饱和或锁竞争时，增加 Core 只会增加排队和一致性流量。

## 5. CPU 与服务器其他部件

```text
Core / Cache
  ├── IMC → DDR Channel → DIMM
  ├── PCIe/CXL Root → GPU/NIC/NVMe
  └── UPI/xGMI → 另一个 Socket
```

CPU 选型会同时决定 Core 数、Memory Channel、PCIe Lane、CXL 能力和 Socket 拓扑。只按 Core 数选型，会忽略真正限制 AI Infra 的内存与 I/O。

## 6. 常用证据

```bash
lscpu -e=CPU,CORE,SOCKET,NODE,CACHE,ONLINE,MAXMHZ,MINMHZ
numactl -H
perf stat -e cycles,instructions,branches,branch-misses,cache-misses -- <command>
```

`perf` 事件名称和可用性取决于 CPU 与 Kernel。生产分析先记录型号、微码、BIOS、电源策略和实际频率。

## 7. 学习验收

- 能解释为什么 CPU 100% 但 IPC 很低；
- 能区分 Core、SMT Thread、Socket 和 NUMA Node；
- 能判断 Branch Miss、LLC Miss、TLB Miss 和远端内存的影响；
- 能解释 False Sharing 与锁竞争为什么产生 Cache Line 抖动；
- 能把线程、内存、IRQ 和 PCIe 设备绑定到合理 NUMA Node。

## 8. 练习与答案

**问题：一颗 32 Core、64 Thread CPU 是否等于 64 个完整 Core？**

答案：不是。SMT 的两个硬件线程共享 Frontend、执行端口和 Cache 等资源，适合填补单线程停顿，但不能提供两倍独立执行资源。

**问题：频率更高的 CPU 是否一定更快？**

答案：不一定。还取决于指令数、IPC、Cache/内存、向量能力、功耗限制和软件并行度。
