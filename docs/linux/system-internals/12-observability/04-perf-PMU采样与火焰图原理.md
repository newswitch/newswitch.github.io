---
title: "perf：PMU、采样与火焰图原理"
sidebar_label: "04. perf、PMU 与火焰图"
sidebar_position: 4
description: "解释计数、采样、multiplex、调用栈、符号化、on/off-CPU profile 和火焰图阅读。"
tags: [Linux, perf, PMU, Profiling, Flame Graph]
---

# perf：PMU、采样与火焰图原理

perf 同时覆盖硬件 PMU、软件计数器、tracepoint 和采样。`perf stat` 回答“发生多少”，`perf record/report` 回答“样本主要落在哪里”。

## 1. 计数与采样

```bash
perf stat -e cycles,instructions,branches,branch-misses,cache-misses -- <workload>
perf record -F 99 -g -- <workload>
perf report
```

采样不是跟踪每次调用。频率越高时间分辨率越好，开销和数据量也越大；非常短函数可能漏采。

## 2. IPC 与 Cache 指标

IPC=`instructions/cycles` 只是窗口平均。高低要结合微架构、向量化、前后端 stall、频率和 workload；不同 CPU 的 raw event 编码不可直接照搬。

`cache-misses` 也可能代表特定通用事件定义，并非“所有级别缓存 miss”。做微架构分析应使用对应 CPU 的 vendor PMU 文档和 `perf list`。

## 3. Multiplex

硬件 counter 数有限，请求事件过多时内核轮换计数并按 enabled/running 时间缩放。报告中运行比例过低会降低可信度，必要时分组分批采集。

## 4. 调用栈

- frame pointer：稳定且开销低，但程序必须保留帧指针。
- DWARF：可在无帧指针时 unwind，开销/数据更大。
- LBR：硬件记录分支，支持范围依赖 CPU。

符号化需要匹配二进制、debug info、Build ID 和 JIT map。`[unknown]` 不是性能结论。

## 5. 火焰图

横向宽度表示样本数量，不是时间顺序；纵向是调用栈深度。on-CPU 火焰图显示正在运行的 CPU 栈，无法直接显示睡眠等待。off-CPU 分析需要调度事件记录阻塞时长和唤醒关系。

## 6. 权限与扰动

`perf_event_paranoid`、kptr_restrict、容器 capability 和 LSM 影响采集。降低安全限制前应限定用户、主机和数据范围。

## 7. 练习与答案

**问题：函数在火焰图最宽，是否应该立刻优化它？**

答案：不一定。它可能是预期工作、下游调用累计或采样偏差；先确认该函数是否位于关键请求、能否减少工作且不转移瓶颈。

**问题：CPU 利用率低时 perf on-CPU profile 能解释全部延迟吗？**

答案：不能。大量时间可能在锁、IO、调度或 cgroup throttle，需要 off-CPU 和子系统证据。

下一篇：[ftrace、Tracepoint、Kprobe 与 Uprobe](./05-ftrace-Tracepoint-Kprobe与Uprobe.md)
