---
title: "Cache、Cache Line、TLB 与 MESI 一致性"
sidebar_label: "02. Cache、TLB 与 MESI"
sidebar_position: 2
description: "理解 CPU Cache 层次、Cache Line、局部性、False Sharing、TLB、MESI 和多核一致性流量。"
tags: [CPU Cache, Cache Line, TLB, MESI, False Sharing]
---

# Cache、Cache Line、TLB 与 MESI 一致性

CPU Core 的计算速度远高于 DRAM 访问速度。Cache 保存近期数据和指令，TLB 缓存地址翻译；多核一致性协议则保证多个 Cache 对共享内存具有架构规定的一致视图。

## 1. 典型层次

```text
Register
→ L1 Data / L1 Instruction
→ L2 Cache
→ Last Level Cache（L3/LLC）
→ Local DRAM
→ Remote Socket DRAM
→ Storage
```

越靠近 Core，容量通常越小、延迟越低、带宽越高。具体共享关系取决于微架构：L2 可能每 Core 私有，LLC 可能按 Slice 分布。

## 2. Cache Line 是搬运单位

CPU Cache 通常以固定大小 Cache Line 管理数据，而不是只加载程序请求的一个字节。若 Line 为 64 Byte，读取其中一个字段可能带入相邻字段。

这产生两种效果：

- Spatial Locality：顺序访问相邻数据可利用已加载 Line；
- Wasted Fetch：随机访问只使用 Line 中很少部分，浪费带宽与容量。

不要把“64 Byte”当所有架构永恒常数，应从系统信息和厂商文档确认。

## 3. Cache 映射与冲突

Cache 由 Set 和 Way 组成。一个内存地址只能映射到特定 Set，可存入其中某个 Way。多个热点地址持续映射同一 Set，会产生 Conflict Miss，即使总工作集小于 Cache 容量。

常见 Miss：

- Compulsory：第一次访问；
- Capacity：工作集超过容量；
- Conflict：映射竞争；
- Coherence：其他 Core 写入导致 Line 失效。

## 4. Write-back 与 Dirty Line

Write-back Cache 中，CPU 写入先修改 Cache Line 并标记 Dirty，稍后再写回下级。它减少总线写流量，但掉电一致性不能只靠 CPU Cache；持久化系统需要 `fsync`、Flush、设备 PLP 等完整链路。

## 5. MESI 简化模型

| 状态 | 含义 |
| --- | --- |
| Modified | 本 Core 独占且已修改，与内存不同 |
| Exclusive | 本 Core 独占但干净 |
| Shared | 多个 Core 可持有干净副本 |
| Invalid | 当前副本不可用 |

Core A 要写一个 Shared Line 时，需要获得所有权并使其他 Core 副本失效。真实服务器协议可能是 MESIF、MOESI 或目录式实现，但核心问题仍是“谁持有最新数据、谁有写权限”。

## 6. False Sharing

两个线程修改不同变量，但变量位于同一 Cache Line：

```text
Cache Line: [counter_A][counter_B][padding...]
CPU0 写 counter_A
CPU1 写 counter_B
→ Line 所有权在 Core 间来回迁移
```

逻辑上没有数据冲突，硬件上却产生一致性 Ping-pong。解决方式可能是 Padding、Per-CPU Counter、分片或降低共享写频率。

Padding 会增加内存占用和 Cache Footprint，不能对所有结构盲目填充。

## 7. NUMA 会放大一致性成本

同 Socket Core 之间的一致性可能经过片上 Fabric；跨 Socket 则需要 UPI/xGMI 等互联。共享写热点跨 Socket 时，既有 Cache Line 所有权迁移，又占用 Socket Link。

锁、队列头和全局计数器是常见热点。将相关线程和内存放在同一 NUMA Node，或改为分片数据结构，通常比只提高频率有效。

## 8. TLB 缓存地址翻译

CPU 使用虚拟地址，Page Table Walk 将其翻译为物理地址。TLB 缓存近期翻译：

```text
Virtual Address
→ TLB Hit：快速得到 Physical Page
→ TLB Miss：硬件/软件遍历多级 Page Table
→ 再访问 Cache/DRAM
```

TLB Miss 不等于 Page Fault：页可能已经在内存，只是翻译不在 TLB。Page Fault 则表示页表权限/映射不存在或需 OS 介入。

## 9. Huge Page 的作用

更大 Page 让一个 TLB Entry 覆盖更多内存，减少 TLB Pressure 和 Page Table 层级开销，适合大连续内存工作集、DPDK、数据库和部分 AI Runtime。

代价包括内存碎片、分配失败、内部浪费和 NUMA 放置复杂。Transparent Huge Page 与显式 HugeTLB 的生命周期也不同。

## 10. Prefetch

硬件 Prefetcher 识别顺序或固定步长访问，提前把数据带入 Cache。规则访问能受益，随机 Pointer Chasing 很难预取。

软件 Prefetch 过早会被驱逐，过晚无法隐藏延迟，还可能污染 Cache。必须用硬件指标和 A/B 测试验证。

## 11. 观测方法

```bash
perf stat -e cache-references,cache-misses,dTLB-loads,dTLB-load-misses -- <command>
perf c2c record -- <command>
perf c2c report
```

事件支持依平台而异。`perf c2c` 可帮助定位共享 Line 和 HITM 等一致性热点，但生产采样需要评估开销和权限。

## 12. 练习与答案

**问题：两个线程只写各自的变量，为什么仍会互相影响？**

答案：若变量位于同一 Cache Line，硬件一致性以 Line 为单位，写操作会使 Line 所有权在 Core 间迁移，形成 False Sharing。

**问题：TLB Miss 是否意味着访问磁盘？**

答案：不是。TLB Miss 通常触发 Page Table Walk；只有发生需要调页的 Major Page Fault 等情况，才可能进入存储路径。

延伸阅读：

- [虚拟地址、页表、TLB 与缺页异常](../../linux/system-internals/04-memory-management/01-虚拟地址页表TLB与缺页异常.md)
- [原子操作、内存屏障与可见性](../../linux/system-internals/08-interrupts-concurrency/04-原子操作内存屏障与可见性.md)
