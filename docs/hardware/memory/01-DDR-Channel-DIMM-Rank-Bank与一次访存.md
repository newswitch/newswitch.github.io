---
title: "DDR、Channel、DIMM、Rank、Bank 与一次访存"
sidebar_label: "01. DDR 结构与一次访存"
sidebar_position: 1
description: "从内存控制器、Channel、DIMM、Rank、Chip、Bank、Row 和 Column 解释一次 DDR 读写与带宽延迟。"
tags: [DDR, Memory Channel, DIMM, Rank, Bank, DRAM]
---

# DDR、Channel、DIMM、Rank、Bank 与一次访存

DRAM Cell 通过电荷表示数据，需要周期刷新。CPU 并不直接对某颗 Cell 发普通 Load，而是由 IMC 将物理地址映射为 Channel、Rank、Bank、Row 和 Column，再按 DDR 时序发命令。

## 1. 层次关系

```text
CPU Socket
└── Integrated Memory Controller
    ├── Channel 0
    │   ├── DIMM Slot A → DIMM
    │   │   ├── Rank 0 → 多颗 DRAM Chip 协同提供总线位宽
    │   │   │   └── Bank Group → Bank → Row → Column
    │   │   └── Rank 1
    │   └── DIMM Slot B
    ├── Channel 1
    └── ...
```

DDR5 等代际会在 DIMM 内进一步划分 Subchannel，具体位宽和组织应按平台手册确认。核心仍是多级并行与地址映射。

## 2. DIMM 不等于 Channel

- Channel：IMC 的独立数据/命令通路；
- Slot：主板上的物理连接器；
- DIMM：插入 Slot 的模块；
- DPC：每个 Channel 安装多少 DIMM。

一个 Channel 可以有多个 Slot。2DPC 增加电气负载，平台可能降低数据率以保证信号完整性。

## 3. Rank 是什么

一个 Rank 是一组同时响应 Chip Select、共同形成数据总线宽度的 DRAM Chip。Dual Rank DIMM 在同一模块上有两组 Rank，但同一时刻 Channel 数据线通常只选择其中一组传输。

更多 Rank 可以让 IMC 在一个 Rank 等待时切换另一个 Rank，提高并行度；也会增加负载、功耗和训练复杂度。

## 4. Bank、Row 与 Row Buffer

DRAM 访问简化为：

```text
ACTIVATE：把某个 Row 打开到 Row Buffer
READ/WRITE：访问该 Row 的 Column
PRECHARGE：关闭当前 Row，准备打开另一个 Row
```

- Row Hit：目标就在已打开 Row，只需 Column 访问；
- Row Miss/Conflict：需要 Precharge + Activate，延迟更高；
- 多 Bank：允许不同 Bank 交错处理，隐藏部分等待。

顺序访问通常比完全随机访问更容易获得 Row Locality 和 Prefetch 收益。

## 5. DDR 时序

常见概念：

- CAS Latency：读命令到数据输出的相关等待；
- tRCD：Activate 到 Read/Write；
- tRP：Precharge 时间；
- tRAS：Row 保持激活的最小时间；
- Refresh：恢复 Cell 电荷，期间会占用部分资源。

时序通常以 Cycle 表示，实际纳秒还要结合 Clock。不同数据率不能只比较 CL 数字。

## 6. 为什么叫 Double Data Rate

DDR 在时钟两个边沿传输数据。标称 MT/s 是每秒百万次数据传输，不直接等同 MHz Core Clock。

```text
DDR5-4800：约 4800 MT/s
64-bit 数据 Channel：每次 8 Byte
理论带宽：4800M × 8 ≈ 38.4 GB/s
```

实际持续带宽会受命令、刷新、读写切换、地址分布、内存控制器和 CPU 工作负载影响。

## 7. 地址交错

IMC 将物理地址位映射到 Channel/Rank/Bank/Row/Column，并可做 Channel Interleaving。连续地址分散到多个 Channel 时能并行使用带宽。

加密/Hash 地址映射和厂商实现可能使简单的“某段地址属于某 Channel”推断失效。性能实验需结合平台文档和硬件计数器。

## 8. 一次 CPU Load

```text
Virtual Address
→ TLB / Page Table 得到 Physical Address
→ L1/L2/LLC Miss
→ Home Agent / Memory Fabric
→ IMC 请求队列
→ 地址映射到 Channel/Rank/Bank/Row/Column
→ DRAM 命令与数据传输
→ Cache Line 填入 LLC/L2/L1
→ Load 获得目标字节
```

程序只读取 8 Byte，也可能传输完整 Cache Line。随机小访问的瓶颈常是延迟和并发，不是标称总带宽。

## 9. Read/Write Queue 与调度

IMC 会重排请求以增加 Row Hit、批量处理读写并遵守公平/时序约束。高写入压力、读写切换和某些地址模式会增加尾延迟。

多线程能提高 Outstanding Request、利用 Bank/Channel 并行，但达到带宽饱和后继续加线程只会增加排队。

## 10. 内存带宽实验

使用经过验证的工具测顺序读、写、Copy 和随机访问；同时固定：

- NUMA Node 与线程数；
- 内存 First-touch；
- 实际 DIMM 频率和 Channel Population；
- CPU 频率/功耗状态；
- 是否启用 SMT、Huge Page 和 Prefetch。

不要用 `memcpy` 单线程结果直接代表整机峰值。

## 11. 练习与答案

**问题：为什么随机访问即使总数据量不大也可能很慢？**

答案：随机地址降低 Cache/Row Locality，频繁 Row Conflict，并可能无法形成足够并发隐藏 DRAM 延迟。

**问题：增加 Rank 是否等于增加 Channel？**

答案：不等于。Rank 共享所在 Channel 的数据线；它可增加 Rank-level 并行和容量，但不会创造独立 Channel 带宽。
