---
title: "一次 CPU 指令从程序、虚拟地址到内存完成读取"
sidebar_label: "01. CPU 指令与一次访存"
sidebar_position: 1
description: "从源码、编译、ELF、进程调度和指令流水线出发，追踪虚拟地址经过 TLB、页表、Cache、内存控制器到 DIMM 的读取与返回。"
tags: [CPU, 指令, 虚拟地址, TLB, Cache, DRAM]
---

# 一次 CPU 指令从程序、虚拟地址到内存完成读取

普通变量读取通常不会调用内核函数。编译器生成 Load 指令，CPU 在用户态执行；只有地址未建立映射、权限错误或其他异常时，才陷入内核处理。

## 1. 从源码到可执行指令

```c
long value = array[index];
```

大致经历：

```text
Source
→ Compiler Frontend / Optimization
→ Machine Instruction
→ Object File
→ Linker 生成 ELF
→ Loader 建立进程地址空间
→ Scheduler 让线程在某个 CPU 运行
→ CPU 取指并执行 Load
```

编译器可能把变量保存在 Register、消除重复读取或使用 Vector Load，因此源码一行不一定对应一次内存访问。

## 2. 指令怎样到达 Core

CPU 根据 Instruction Pointer 获取指令：

```text
Virtual PC
→ Instruction TLB
→ L1 Instruction Cache
→ Decode / Rename
→ Scheduler / Execution Unit
→ Retire
```

若指令不在 L1I，会继续查更低级 Cache 或内存；若分支预测错误，错误路径的指令被丢弃并重新取指。

## 3. Load 的虚拟地址

Load/Store Unit 计算 Effective Address：

```text
Base Register + Index × Scale + Displacement
→ Virtual Address
```

虚拟地址先按进程页表转换为物理地址。不同进程可使用相同虚拟地址，却映射到不同物理页面。

## 4. TLB 命中

TLB 缓存近期地址转换：

```text
Virtual Page Number → Physical Page Number + Permission
```

命中后无需读取多级页表；未命中时由硬件 Page Walker 或架构定义的软件路径读取页表。Page Walk 本身也会访问 Cache/内存。

## 5. Page Fault 不是 TLB Miss

- TLB Miss：转换缓存没有条目，但页表可能已经有效；
- Minor Fault：页表需要由 Kernel 建立，但数据已在内存或无需磁盘 I/O；
- Major Fault：通常需要从文件/交换设备读取页面；
- Protection Fault：访问权限不允许，可能产生信号。

Page Fault 进入 Kernel 后，当前指令尚未完成。内核准备页面和 PTE 后返回用户态，CPU 重新执行 Faulting Instruction。

## 6. Cache 查找

地址转换与 Cache 查找的具体并行方式取决于微架构。逻辑上：

```text
Physical Address
→ L1 Data Cache
→ L2 Cache
→ Last-Level Cache
→ Home Agent / Memory Controller
→ DDR Channel / DIMM
```

Cache 以 Cache Line 为单位搬运，不是只取源码变量的几个字节。相邻数据可能一起进入 Cache。

## 7. 一致性和所有权

多 Core 缓存同一 Cache Line 时，一致性协议维护可见性。Load 若能在本地 Cache 获得有效副本就完成；如果其他 Core 持有修改后的副本，可能先发生 Snoop、转移或写回。

锁、原子操作和内存屏障还会约束访问顺序。Cache Coherence 保证单个 Line 的一致性，不自动保证高级语言所有并发逻辑正确。

## 8. 到 DRAM 的路径

Last-Level Cache Miss 后：

```text
Core / LLC
→ Memory Controller Queue
→ 地址映射到 Channel / DIMM / Rank / Bank / Row
→ ACTIVATE（必要时）
→ READ
→ Data Burst 返回
→ 填入 Cache Line
→ Load 得到目标字节
```

若物理页面位于另一 NUMA Node，请求和数据还要经过 Socket Interconnect。

## 9. 指令何时算完成

乱序 CPU 可以在 Load 等待时执行其他无依赖指令，但依赖该值的指令会等待。最终只有当指令按程序顺序 Retire 后，其架构结果才正式可见。

异常或分支错误路径上的推测结果不会 Retire，但可能已经改变 Cache 等微架构状态。

## 10. 关键软件对象

| 对象 | 作用 |
| --- | --- |
| ELF Program Header | 描述可装载 Segment |
| `mm_struct` | 进程地址空间 |
| VMA | 一段连续虚拟地址及权限/来源 |
| Page Table/PTE | 虚拟页到物理页和权限映射 |
| Physical Page/Folio | Kernel 管理的物理内存对象 |
| CPU Register | 指令直接操作的架构状态 |

这些软件对象负责建立条件，真正的普通 Load 由 CPU 硬件执行。

## 11. 观测与定位

```bash
perf stat -e cycles,instructions,cache-misses,page-faults -- ./app
perf record -g ./app
cat /proc/<pid>/maps
cat /proc/<pid>/numa_maps
numastat -p <pid>
```

不同 CPU 的 PMU 事件不同。`cache-misses` 是抽象事件，精确分析需按型号选择 L1/LLC、TLB、Memory Stall 等事件。

## 12. 练习与答案

**问题：读取一个已经映射且在 L1 Cache 中的变量，会进入 Kernel 吗？**

答案：通常不会。CPU 在用户态完成地址转换、权限检查和 Cache 读取。只有异常、Fault、调度或其他事件才进入 Kernel。

**问题：TLB Miss 是否意味着访问 DRAM？**

答案：不一定。页表项可能存在于 CPU Cache，数据本身也可能在 L1/L2/LLC；TLB Miss 只说明地址转换缓存未命中。

延伸阅读：

- [虚拟地址、页表、TLB 与缺页异常](../../linux/system-internals/04-memory-management/01-虚拟地址页表TLB与缺页异常.md)
- [Cache、Cache Line、TLB 与 MESI](../cpu/02-Cache-CacheLine-TLB与MESI一致性.md)
