---
title: "Go Heap、Alloc 与 RSS：分配很多和保留很多不是同一问题"
sidebar_label: "02. Go Heap、Alloc 与 RSS：分配很多和保留很多不是同一问题"
sidebar_position: 2
description: "内存排查先统一统计范围，再追踪分配与保留。把累计分配、当前存活、Runtime 保留页和 RSS 混成一个数字，通常会导致错误调参或没有效果的重启。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Heap、Alloc 与 RSS：分配很多和保留很多不是同一问题

内存排查先统一统计范围，再追踪分配与保留。把累计分配、当前存活、Runtime 保留页和 RSS 混成一个数字，通常会导致错误调参或没有效果的重启。

## 1. 四个 profile 维度的不同问题

inuse_space 关注仍保留的分配字节，inuse_objects 关注对象数量，alloc_space/alloc_objects 关注累计分配。大对象少量保留与小对象大量创建需要不同修复。

profile 是采样估计，不保证每个小对象都出现。Runtime.MemStats 可补充总量与周期信息，但取值时刻、GC 阶段和其他后台分配会影响快照。

## 2. 堆与进程内存之间还隔着什么

已回收对象的空间可以留在 Runtime 内复用，未必立即归还 OS。栈、元数据、CGO、mmap 以及设备/外部库分配也可能不出现在普通 Go heap 的同一口径里。

因此 heap 下降而 RSS 未立即下降不能单独证明泄漏；RSS 上升而 heap 稳定，也不能就认定是 GC 不工作。结合容器事件、映射、Runtime 指标和进程资源定位。

## 3. 先在同阶段采样

比较前固定构建、流量、输入大小、并发与预热状态。新进程的缓存建立不应直接与运行数小时的峰值快照相减，累计分配更不能跨不同持续时长直接比较。

用明确的前后阶段：基线 GC → 执行有限工作 → GC 后采集 → 切断引用 → 再采集。强制 GC 适合受控因果实验，不是给每个生产请求加清理步骤。

## 4. 运行可控保留对照

```bash
cd examples/go/core-lab
go run ./cmd/runtime-lab -mode view -dir out/view
go run ./cmd/runtime-lab -mode clone -dir out/clone
go tool pprof -top -sample_index=inuse_space out/view/retained.pprof
go tool pprof -top -sample_index=inuse_space out/clone/retained.pprof
```

两个进程都只保存可见 64 字节。一次测量 view 增加约 8 MiB HeapAlloc，clone 仅增加 64 字节；说明生命周期不同，而不是输入工作量不同。完整分析见 [小切片保留大数组](./06-小切片保留大数组的内存排查.md)。

对照必须在 helper 返回后观察，避免仍被本地变量意外保留；runtime.KeepAlive 用于在需要的采样边界维持对象存活，不是生产防泄漏工具。

## 5. 分配点不是保留链的全部

profile 常告诉我们缓冲在 bytes.Repeat 或解析器中创建。保留它的却可能是长期 Map、闭包、队列或活跃请求。不能把分配函数从 A 改名为 B 就算修复。

逐层检查对象所有权：谁创建、传给谁、是否 Clone、谁保存、何时删除、是否有别名。含指针的 Slice 删除逻辑元素后，还应检查不再使用槽位是否保留引用。

## 6. 高分配与高存活的分流

alloc_space 高而 live 稳定：查重复解码、动态容器、字符串转换、编码和日志；live 随负载持续不回落：查缓存容量、排队、未结束 G 与对象保留。

对象池可能减少分配，却永久保留超大 Buffer，最终峰值更差。池元素可能被 Runtime 丢弃，也不是可靠缓存。对池容量和敏感数据做约束，不以“用了 Pool”代替 profile。

## 7. 修复验收要同时看成本

在相同负载下看 live heap、分配率、GC CPU、峰值 RSS、P99 和错误率。复制小结果可能显著释放大数组，但全量复制所有请求会增加成本；应验证真实保留比例与生命周期。

若对象已释放但 RSS 回落不符合预期，继续看可复用页、映射与非 Go 分配。不要仅为了图表好看，在请求路径强制 GC 或频繁 FreeOSMemory。

## 8. 练习与答案

### 8.1 inuse_space 高是否说明每次请求都在分配很多

不一定。可能是少量长期大对象，需与 alloc_space、对象数量及请求量一起看。

### 8.2 为什么 profile 不能总直接指出谁保留对象

它主要按分配调用栈归属样本，引用关系需要结合生命周期和代码追踪。

### 8.3 池化后 allocs 降低但 RSS 增大 应如何判断

检查池是否保留过大对象和峰值容量，结合业务延迟及GC成本综合判断，而不是只看 allocs 一项。

## 9. 参考资料

- [runtime.MemStats](https://pkg.go.dev/runtime#MemStats)
- [Heap profile](https://pkg.go.dev/runtime/pprof#hdr-Heap_profile)
- [可重复内存实验](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab/internal/runtimeprobe)
