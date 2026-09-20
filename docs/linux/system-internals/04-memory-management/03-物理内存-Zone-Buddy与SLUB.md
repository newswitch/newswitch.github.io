---
title: "物理内存、Zone、Buddy 与 SLUB：内核怎样分配页和小对象"
sidebar_label: "03. 物理内存、Zone、Buddy 与 SLUB"
sidebar_position: 3
description: "解释 NUMA Node、内存 Zone、struct page、伙伴系统、连续页、SLUB cache 与内核内存统计。"
tags: [Linux, Buddy, SLUB, Zone, 物理内存]
---

# 物理内存、Zone、Buddy 与 SLUB：内核怎样分配页和小对象

Linux 不把全部 RAM 看成一个简单字节池。物理页属于 NUMA Node 和 Zone，伙伴系统管理不同阶的连续页块，SLUB 等 slab 分配器再把页面切成内核常用小对象。

## 1. 物理内存层次

```text
系统物理内存
└── NUMA Node
    └── Zone（DMA/DMA32/Normal/Movable 等）
        └── Page Frame
            └── order-n 连续页块
```

Zone 解决不同硬件地址能力和可迁移性需求。具体 Zone 是否存在、范围多大与架构、设备和内核配置有关。

`struct page`/folio 是内核管理物理页的元数据，不是页内容本身。它记录引用、映射、状态和所属关系；大量物理页意味着这些元数据本身也需要内存。

## 2. Buddy System

伙伴系统以 2 的幂次管理连续基础页：order 0 是 1 页，order 1 是 2 页，order 2 是 4 页，以此类推。分配高阶块时，如果没有现成块，就拆分更高阶块；释放时若伙伴空闲则合并。

```text
order 3：8 页
  → 拆成两个 order 2
  → 其中一个再拆成两个 order 1
```

总空闲内存很多但缺少足够大的连续块时，高阶分配仍可能失败，这就是外部碎片问题之一。

## 3. 为什么小对象不用每次占一页

inode、dentry、网络对象等通常小于一页。如果每个对象单独分配页，会浪费空间并增加初始化成本。SLUB 按对象类型维护 cache，把一组页切成相同大小 slot：

```text
kmem_cache
→ slab（一组页面）
→ object slots
→ per-CPU freelist 快速分配
```

对象 cache 可以复用已初始化布局，并利用 per-CPU 路径减少锁竞争。代价是内部碎片和空闲对象保留。

## 4. 怎样观察伙伴系统

```bash
cat /proc/buddyinfo
cat /proc/zoneinfo | less
grep -E 'MemFree|Slab|SReclaimable|SUnreclaim|KernelStack|PageTables' /proc/meminfo
```

示例 `buddyinfo`：

```text
Node 0, zone   Normal  1200  840  310  96  24  5  1  0  0  0  0
```

各列是不同 order 的空闲块数量，不是字节数。需要结合基础页大小和 order 计算容量。高阶列长期为零提示连续块稀缺，但不能脱离实际分配需求判定故障。

## 5. 怎样观察 slab

```bash
slabtop -o
cat /proc/slabinfo | head
grep -E 'Slab|SReclaimable|SUnreclaim' /proc/meminfo
```

- `SReclaimable` 表示在适当条件下可回收的部分，不保证能立即全部释放。
- `SUnreclaim` 表示通常不能由通用 shrinker 轻易回收的 slab。
- 某 cache 增长可能是业务对象增加、延迟回收或内核/驱动泄漏，需要按对象数、单对象大小和时间趋势分析。

## 6. 分配标志和上下文

内核分配不仅指定大小，还通过 GFP 标志表达：能否睡眠、可访问哪些 Zone、是否允许回收、是否用于文件系统/IO 路径等。中断上下文不能执行可能睡眠的常规分配；关键路径可能使用预留内存池。

因此“系统有空闲内存”不代表任意上下文、任意 Zone、任意连续阶都能成功分配。

## 7. 碎片的两种含义

- 外部碎片：空闲页分散，无法形成所需连续块。
- 内部碎片：已分配块或对象 slot 大于实际需求，空间留在块内部。

用户态 malloc 碎片、slab 内部碎片和伙伴系统外部碎片是不同层次，不能用一个指标解释全部。

## 8. 练习与答案

**问题：`MemFree` 有 20GB，为什么 order-9 分配仍可能失败？**

答案：20GB 可能由大量离散小块组成，或位于不符合约束的 Node/Zone。order-9 请求需要一段连续的 512 个基础页块。

**问题：Slab 很大是否一定是内核泄漏？**

答案：不是。目录项、inode、网络连接等业务对象会正常增长，部分 cache 可回收。应结合对象数量、`SReclaimable/SUnreclaim`、业务负载和持续趋势判断。

下一篇：[Page Cache、mmap 与共享内存](./04-Page-Cache-mmap与共享内存.md)
