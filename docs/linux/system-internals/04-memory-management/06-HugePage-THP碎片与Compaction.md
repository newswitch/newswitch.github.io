---
title: "HugePage、THP、碎片与 Compaction：大页为什么既能加速也会制造长尾"
sidebar_label: "06. HugePage、THP、碎片与 Compaction"
sidebar_position: 6
description: "区分基础页、HugeTLB 与透明大页，解释 TLB 收益、连续内存、内存规整、拆分和延迟风险。"
tags: [Linux, HugePage, THP, Compaction, 内存碎片]
---

# HugePage、THP、碎片与 Compaction：大页为什么既能加速也会制造长尾

更大的页面能用更少页表项覆盖更大内存，降低 TLB 压力；但大页需要更大的连续物理内存和更粗的回收粒度，分配、规整和拆分都可能产生延迟。

## 1. 三类页面概念

| 类型 | 管理方式 | 典型用途 |
|---|---|---|
| 基础页 | 普通页表和伙伴系统 | 通用内存 |
| HugeTLB 静态大页 | 预留池、显式映射 | 数据库、DPDK、确定性大页需求 |
| Transparent Huge Page | 内核自动或按 madvise 聚合 | 匿名内存等通用场景 |

x86_64 上常见基础页 4KiB、大页 2MiB/1GiB，但具体能力依架构和内核配置，不能写成普遍常数。

## 2. TLB 收益

相同 TLB 条目数量下，2MiB 页比 4KiB 页覆盖的地址范围大 512 倍。大工作集、连续访问和页表遍历开销高的应用可能受益：

- TLB miss 减少。
- 页表层级和页表内存压力下降。
- 某些内存密集型工作负载吞吐提高。

如果工作集小、访问稀疏或瓶颈不在 TLB，大页收益可能有限。

## 3. 连续内存从哪里来

大页要求在相应 Node/Zone 找到大块连续物理页。系统运行久后，已分配页面交错分布，即使总空闲量充足也可能缺连续块。内核可迁移可移动页面，把空洞合并成连续区域，这就是 Compaction。

```text
离散空闲页
→ 迁移可移动页面
→ 聚合连续空闲范围
→ 满足高阶/大页分配
```

页面不可迁移、被 pin、长期引用或位于不合适 Zone 时，规整可能失败。

## 4. THP 的延迟风险

THP 可能在缺页时同步尝试分配/规整大页，或由 `khugepaged` 后台合并。同步规整会把延迟记在触发分配的业务线程上。大页还可能因为 COW、回收或部分修改而拆分。

```bash
cat /sys/kernel/mm/transparent_hugepage/enabled
cat /sys/kernel/mm/transparent_hugepage/defrag
grep -E 'AnonHugePages|ShmemHugePages|FileHugePages|HugePages_' /proc/meminfo
grep -E 'thp_|compact_' /proc/vmstat
```

方括号表示当前模式。例如 `[madvise]` 通常表示应用明确提示的区域优先使用 THP。发行版默认值可能不同。

## 5. HugeTLB 预留

显式 HugeTLB 页面通常从专用池分配，不像普通 Page Cache 那样随意回收。预留过多会减少普通内存；预留过晚又可能因碎片失败。还要考虑每 NUMA Node 分布和应用绑定。

```bash
grep -E 'HugePages|Hugepagesize|Hugetlb' /proc/meminfo
find /sys/devices/system/node -path '*hugepages*' -type f -maxdepth 6 2>/dev/null
```

修改大页数量会改变系统内存布局，生产操作前必须评估和保留回退。

## 6. GPU/NPU 场景的额外边界

设备 DMA、注册内存和通信库可能 pin 住主机页，使其暂时不能回收或迁移。模型权重主要占设备显存时，主机侧仍可能有 Page Cache、数据加载、Pinned Memory、通信缓冲和页表开销。不能用 GPU 显存指标替代主机内存分析。

## 7. 练习与答案

**问题：总空闲内存 30GiB，为什么申请 1GiB HugePage 失败？**

答案：需要满足大小、对齐、Node/Zone 和连续性条件。空闲页可能分散或不可迁移，无法组成所需连续块。

**问题：开启 THP 是否一定提升数据库或推理性能？**

答案：不一定。收益取决于 TLB 压力和访问模式，成本包括规整、COW、拆分和回收长尾，必须用目标负载验证吞吐和尾延迟。

下一篇：[NUMA 内存局部性](./07-NUMA内存局部性.md)
