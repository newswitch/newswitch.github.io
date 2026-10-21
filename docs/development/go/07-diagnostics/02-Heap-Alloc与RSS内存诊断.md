---
title: "Go Heap、Alloc 与 RSS：分配很多和保留很多不是同一问题"
sidebar_label: "02. Go Heap、Alloc 与 RSS：分配很多和保留很多不是同一问题"
sidebar_position: 2
description: "堆 profile 是对象分配与存活的采样视角，RSS 是操作系统观察的驻留内存。先区分口径，再判断泄漏、分配抖动和容器 OOM。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Heap、Alloc 与 RSS：分配很多和保留很多不是同一问题

堆 profile 是对象分配与存活的采样视角，RSS 是操作系统观察的驻留内存。先区分口径，再判断泄漏、分配抖动和容器 OOM。

## 1. 四个常见样本维度

inuse_space 看仍保留的分配字节，inuse_objects 看存活对象数量，alloc_space 看累计分配字节，alloc_objects 看累计对象数。累计分配高但保留稳定，往往是临时对象多，而非一定泄漏。

heap profile 不直接包含所有 CGO、映射和内核资源。RSS 也受页面驻留与归还时机影响，不能用一个指标替代另一个。

## 2. 可控内存样本

```bash
cd examples/go/core-lab
go run ./cmd/profile -mode heap -dir out -duration 100ms
go tool pprof -top -sample_index=inuse_space out/heap.pprof
```

示例保留八个 1 MiB 缓冲区，主动 GC 后写 profile，然后进程退出。一轮采样中 main.main 约占 5921 kB，而非精确 8192 kB；采样与估算会有误差，不应拿差值推断内存损坏。

程序只保留有限大小，不制造 OOM。完整代码在 core-lab 的 cmd/profile。

## 3. 找保留链与分配热点

比较同样负载、同样阶段的两个快照，区分预热、缓存稳定增长和持续无界增长。profile 常指出分配来源，真正保留它的 Map/闭包/队列还需结合代码和对象生命周期分析。

优先检查大切片的小视图、无过期缓存、未结束 Goroutine、响应 ReadAll、重复解码和日志缓冲。不能看到 make 出现在热点就把所有分配搬到全局池。

## 4. 修复后的验证

在相同流量与持续时间下比较 live heap、alloc rate、GC CPU、RSS、请求延迟和错误率。池化可能减少分配，却长期保留大容量缓冲，导致 RSS 更高。

按服务边界限制缓存、任务正文和并发，设置 GOMEMLIMIT 时给非 Go 内存留余量。对 OOMKill 还要检查容器事件、cgroup 和峰值，不只是最终 heap 文件。

## 5. 练习与答案

### 5.1 alloc_space 上涨必然表示泄漏吗

不一定，它是累计分配口径。

### 5.2 heap 与 RSS 应该精确相等吗

不应，统计范围与归还机制不同。

### 5.3 对象池一定降低内存峰值吗

不一定，可能长期保留大对象。

## 6. 参考资料

- [runtime.MemStats](https://pkg.go.dev/runtime#MemStats)
- [heap profiles](https://pkg.go.dev/runtime/pprof#hdr-Heap_profile)
