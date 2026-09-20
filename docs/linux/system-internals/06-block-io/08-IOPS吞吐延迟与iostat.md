---
title: "IOPS、吞吐、延迟与 iostat：每个指标究竟在观察哪一层"
sidebar_label: "08. IOPS、吞吐、延迟与 iostat"
sidebar_position: 8
description: "解释 iostat r/s、w/s、await、aqu-sz、util、请求大小、合并和多队列设备的正确判读方法。"
tags: [Linux, iostat, IOPS, Latency, Queue Depth]
---

# IOPS、吞吐、延迟与 iostat：每个指标究竟在观察哪一层

设备指标是块层观察结果，不直接等于应用请求。Page Cache、预读、回写、请求合并、Device Mapper 和远端存储都会改变数量与时序。

## 1. 四个核心量

| 指标 | 含义 |
|---|---|
| IOPS | 每秒完成/提交的块请求数量口径 |
| Throughput | 每秒传输数据量 |
| Latency | 请求在观察边界内经历的时间 |
| Queue depth | 同时排队或在途的请求数量 |

小块随机 workload 常受 IOPS 和固定开销限制；大块顺序 workload 更可能受带宽限制。

## 2. 常见 iostat 字段

不同 sysstat 版本字段略有差异，典型扩展输出：

- `r/s`、`w/s`：每秒读写请求。
- `rkB/s`、`wkB/s`：吞吐。
- `rareq-sz`、`wareq-sz`：平均请求大小。
- `r_await`、`w_await`：相应请求平均等待/服务时间的块层口径。
- `aqu-sz`：平均队列/在途请求数量口径。
- `%util`：设备有 IO 进行的时间比例口径。

```bash
iostat -x -y 1 10
```

`-y` 跳过自启动以来的第一份累计平均，避免与后续区间样本混淆。

## 3. 为什么 util=100% 不总等于饱和

对传统单队列机械盘，持续 100% 常提示设备一直忙；对支持大量并发的多队列 NVMe，任一时刻有请求即可让 busy time 接近 100%，设备仍可能有剩余并行能力。应同时看：

- 吞吐/IOPS 是否接近基线能力。
- await 和尾延迟是否快速上升。
- 队列深度与并发。
- 每队列/控制器和设备内部指标。
- 业务 SLO 是否受影响。

## 4. 平均值掩盖长尾

一秒内 999 个请求 0.2ms、1 个请求 500ms，平均值仍可能看起来不高。设备级 await 还混合多个租户。需要应用直方图、块层延迟分布和后端指标关联。

## 5. 读写归因

```bash
pidstat -d -p ALL 1
cat /proc/<PID>/io
cat /sys/fs/cgroup/<path>/io.stat
iostat -x 1
```

- 进程 write 字节可能先进入 Page Cache，稍后由 flusher 写盘。
- 回写 IO 不一定完全记到最初写入进程。
- 预读可能让设备读大于应用请求。
- 多进程共享 Page Cache 会改变归因。

## 6. 性能曲线而不是单点

基准测试应固定：块大小、读写比、随机/顺序、队列深度、job 数、数据集是否超过缓存、Direct/Buffered、运行时长和预热。输出 IOPS、吞吐和 P50/P95/P99/P999 延迟随并发的曲线。

已有工程实践可继续阅读[存储性能指标与 fio 压测方法](../../../storage/linux-io/03-存储性能指标与fio压测方法.md)。

## 7. 练习与答案

**问题：iostat 显示设备 r/s=0，应用 read 很多，矛盾吗？**

答案：不矛盾。读取可能命中 Page Cache，没有新的设备 IO；也可能实际访问另一层设备或远端文件系统。

**问题：await 低是否证明应用 IO 延迟低？**

答案：不能。应用还可能等待锁、Page Fault、回收、文件系统、cgroup、异步队列和运行时队列，iostat 只覆盖块设备观察边界。

下一篇：[D 状态、IO Hang 与块层故障排查](./09-D状态-IO-Hang与块层故障排查.md)
