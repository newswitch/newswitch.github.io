---
title: "Go 内存分配与 GC：可达性、写屏障、清扫和 Green Tea"
sidebar_label: "03. Go 内存分配与 GC：可达性、写屏障、清扫和 Green Tea"
sidebar_position: 3
description: "GC 回收不可达的 Go 对象，却不替程序关闭连接或删除临时文件。理解分配速率、存活对象和扫描工作，才能解释 GC CPU 与延迟的变化。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go 内存分配与 GC：可达性、写屏障、清扫和 Green Tea

GC 回收不可达的 Go 对象，却不替程序关闭连接或删除临时文件。理解分配速率、存活对象和扫描工作，才能解释 GC CPU 与延迟的变化。

## 1. 从分配到存活对象

小对象通常按大小类别经缓存和 span 等路径分配，大对象走不同路径；布局、含指针与否及对象大小影响成本。分配器管理的是 Go Runtime 内存，并不是每次 make 都直接向操作系统申请同样大小的物理页。

GC 从栈、全局等根追踪可达对象。没有业务价值但仍被 Map、闭包或队列引用的对象依然可达，所以“有 GC”并不等于不会内存泄漏。

## 2. 并发标记与写屏障

标记与业务并发时，对象关系还会改变，写屏障帮助维持扫描正确性。并发不意味着完全没有暂停，阶段切换与协调仍有成本；业务分配太快时还可能承担 GC assist 工作。

清扫回收可再用空间，scavenger 等机制影响何时归还物理页。对象被回收、堆可复用与 RSS 下降是三件不同的事。

## 3. 固定版本说明与实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case gc
```

```text
gc-advanced=true
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

实验主动触发 GC 并比较 NumGC，只用于观察计数，不能证明某个任意对象已被销毁。本系列 Go 1.27.3 默认构建配置中 GreenTeaGC 为开启状态，源码中的扫描组织与旧版不完全相同，不能把多年前的实现细节当作当前唯一模型。

学习时先掌握根、可达性、标记、屏障和清扫，再对照 `runtime/mgc*` 与 `internal/buildcfg/exp.go` 看版本差异；不要把优化名称理解为分代回收或取消写屏障。

## 4. 从症状回到成本

alloc_space 很高但 inuse_space 稳定，常说明临时分配多；inuse_space 持续上涨则应找保留链。GC CPU 高可能来自高分配率、存活集合大、指针密集或过紧内存预算，不是统一调高 GOGC 就能解决。

FD、数据库连接和后台 Goroutine 仍要显式关闭与等待。依赖 finalizer 或清理回调来保证事务释放通常不可靠，因为时间不可控。

## 5. 练习与答案

### 5.1 GC 能回收仍被全局 Map 引用的过期对象吗

不能，只要仍可达就可能保留。

### 5.2 GC 后 RSS 没降能直接判断泄漏吗

不能，还要看堆可用页、Runtime 与 OS 归还行为。

### 5.3 并发 GC 等于没有任何暂停吗

不等于，仍有协调阶段和业务分配成本。

## 6. 参考资料

- [固定版本 GC 源码](https://github.com/golang/go/blob/go1.27.3/src/runtime/mgc.go)
- [固定版本实验基线](https://github.com/golang/go/blob/go1.27.3/src/internal/buildcfg/exp.go)
- [runtime/metrics](https://pkg.go.dev/runtime/metrics)
