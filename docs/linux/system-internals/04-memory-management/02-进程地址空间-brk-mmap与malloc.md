---
title: "进程地址空间、brk、mmap 与 malloc：申请内存时真正发生了什么"
sidebar_label: "02. 地址空间、brk、mmap 与 malloc"
sidebar_position: 2
description: "解释进程地址布局、用户态分配器、brk/mmap、按需分配、overcommit、线程 arena 与内存归还。"
tags: [Linux, malloc, brk, mmap, Overcommit]
---

# 进程地址空间、brk、mmap 与 malloc：申请内存时真正发生了什么

`malloc(1 GiB)` 成功只表示用户态分配器返回了可用虚拟地址范围，不一定已经占用 1 GiB 物理内存。物理页通常在首次访问时按需分配，并受 overcommit、cgroup、NUMA 和回收状态影响。

## 1. 典型地址空间

```text
低地址
├── 程序代码与只读数据
├── 可写数据与 BSS
├── heap（传统 brk 区域，向上增长）
├── mmap 区域：共享库、文件、匿名映射
├── 每线程用户栈（常向下增长）
├── vDSO/vvar
└── 内核保留范围（用户态不可直接访问）
高地址
```

ASLR、架构、PIE、内核配置和运行库会改变具体地址，图只表达逻辑关系。

## 2. malloc 在用户态管理什么

malloc 是运行库/分配器 API，不是系统调用。glibc ptmalloc、jemalloc、tcmalloc 等会向内核申请较大地址区间，再在用户态切分小对象，以避免每次分配都进入内核。

常见后端：

- `brk` 调整传统堆边界。
- 匿名 `mmap` 创建独立映射。
- 已释放块在 allocator arena 中复用。

阈值、arena 和回收策略由分配器及版本决定，不能用“超过固定大小一定 mmap”作为通用规则。

## 3. 从 malloc 到物理页

```text
malloc 请求
→ 分配器是否有空闲块？
  ├─ 有：返回用户地址
  └─ 无：brk/mmap 扩展虚拟地址范围
→ 返回成功
→ 程序首次读写
→ Page Fault
→ 内核分配物理页并更新页表
```

内核可能先把只读匿名访问映射到共享零页，真正写入时再分配独占页。内存清零是安全要求，防止读到其他进程遗留数据。

## 4. Overcommit

Linux 可以允许承诺的虚拟内存超过当前 RAM+Swap，因为许多映射不会全部同时驻留。策略由 `vm.overcommit_memory` 等参数影响：

- 启发式判断。
- 总是允许较积极承诺。
- 按 commit limit 严格记账。

应用看到 malloc 成功，后续触页时仍可能因 cgroup 限制或全局内存压力失败并触发 OOM。需要在申请时确定性失败的系统，必须理解并测试目标环境策略。

```bash
sysctl vm.overcommit_memory vm.overcommit_ratio
grep -E 'CommitLimit|Committed_AS' /proc/meminfo
```

`Committed_AS` 是承诺口径，不是当前实际 RSS。

## 5. free 后内存为什么不下降

释放路径可能只是把块归还用户态 arena，供同一进程复用，并未立即 `munmap` 或缩小 brk。原因包括：

- 空闲块被仍在使用的块夹住，无法整体归还。
- 多线程 arena 保留内存。
- 分配器为了性能缓存块。
- RSS 统计更新和页面回收存在时机差异。

这不自动等于内存泄漏。要观察长期工作集、allocator 指标、映射和分配调用栈。

## 6. 线程栈

每个线程通常预留一段虚拟地址作为用户栈，实际物理页按使用增长。线程数乘以栈上限不等于即时 RSS，但会消耗地址空间、页表和潜在 commit；栈使用过深可能触及 guard page 并崩溃。

```bash
ulimit -s
grep '\[stack' /proc/<PID>/maps
grep -E 'Threads|VmSize|VmRSS|VmData|VmStk' /proc/<PID>/status
```

## 7. 一个正确的内存增长分析

1. VIRT 增长：是否只是保留地址或 mmap 文件。
2. RSS/PSS 增长：哪些映射真正驻留。
3. Anonymous 增长：堆、栈、匿名 mmap 还是共享内存。
4. allocator retained 增长：是否可复用但未归还 OS。
5. cgroup `memory.current/stat`：容器记账是否同步增长。
6. Page Fault 和回收：是否因工作集扩大产生压力。

## 8. 练习与答案

**问题：malloc 返回非 NULL 是否保证后续每个字节都能成功写入？**

答案：不保证。Overcommit 和按需分配允许先返回虚拟地址；触页时还要真正分配物理页，可能受到 cgroup 或全局内存限制并触发 OOM。

**问题：free 后 RSS 不降就一定是泄漏吗？**

答案：不是。分配器可能保留空闲块复用，碎片也可能阻止归还。泄漏要由对象生命周期、分配剖析和持续不可回收增长证明。

下一篇：[物理内存、Zone、Buddy 与 SLUB](./03-物理内存-Zone-Buddy与SLUB.md)
