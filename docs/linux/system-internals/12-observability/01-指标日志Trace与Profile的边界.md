---
title: "指标、日志、Trace 与 Profile 的边界：每种证据能回答什么"
sidebar_label: "01. 指标、日志、Trace 与 Profile"
sidebar_position: 1
description: "比较聚合指标、事件日志、分布式/内核 Trace、采样 Profile 和 Dump，建立证据选择模型。"
tags: [Linux, Metrics, Logs, Trace, Profile]
---

# 指标、日志、Trace 与 Profile 的边界：每种证据能回答什么

同一个“请求慢”问题，用不同证据看到的是不同投影。指标适合发现趋势，Trace 适合还原单次链路，Profile 适合统计时间花在哪里，日志只包含代码主动记录的事件。

## 1. 对照

| 证据 | 数据模型 | 优点 | 常见误区 |
|---|---|---|---|
| 指标 | 时间序列聚合 | 成本低、适合告警与容量 | 平均值掩盖长尾，标签基数失控 |
| 日志 | 离散文本/结构化事件 | 上下文丰富 | 没日志不等于没发生 |
| Trace | 带时间关系的 span/event | 能定位一次请求阶段 | 采样后可能没有故障样本 |
| Profile | 样本在栈/函数上的分布 | 找热点和等待归因 | 不是每次调用的完整录像 |
| Dump | 某时刻状态快照 | 深入对象与内存 | 缺少演化过程，可能包含敏感数据 |

## 2. Counter 与 Gauge

单调 counter 应用区间增量/rate 解释；重启会归零。Gauge 表示瞬时状态，可升可降。把累计 `retransmits` 当当前重传率，或把一次 `queue length=0` 当全天无排队，都会误判。

## 3. 分布与分位数

P99 不能由各实例 P99 简单平均。Histogram 需要统一 bucket 才能聚合估算；summary 的 client-side quantile 通常不能跨实例正确合并。观测长尾还要保留请求规模、错误类别和实例标签。

## 4. 关联同一事件

```text
业务 trace_id / request_id
↕
进程 PID/TID、container ID、cgroup path
↕
Socket 5-tuple、inode、block request、IRQ/queue
↕
统一时钟与主机标识
```

Linux 内核事件通常没有业务 trace_id，需要通过 PID、Socket、cgroup、时间窗口和上下文传播建立关联。

## 5. 选择顺序

1. 指标确定故障时间窗和范围。
2. 日志识别组件状态变化和明确错误。
3. Trace 定位请求阶段/内核等待点。
4. Profile 统计热点与 off-CPU 等待。
5. Dump 用于无法在线解释的崩溃或状态损坏。

## 6. 练习与答案

**问题：CPU profile 中函数占 40% 样本，是否表示单次请求 40% 时间都在该函数？**

答案：不表示。它是采样窗口内命中该栈的比例，混合了请求、线程和采样偏差；要与 workload 和 request trace 关联。

**问题：错误率为 0 是否证明服务健康？**

答案：不证明。请求可能超时在上游、根本没到达、被排队或以成功状态返回错误内容。

下一篇：[procfs、sysfs、debugfs 与 tracefs](./02-procfs-sysfs-debugfs与tracefs.md)
