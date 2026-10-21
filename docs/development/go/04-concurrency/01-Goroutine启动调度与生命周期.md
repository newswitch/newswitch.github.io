---
title: "Go Goroutine：并发、并行、启动与生命周期所有权"
sidebar_label: "01. Go Goroutine：并发、并行、启动与生命周期所有权"
sidebar_position: 1
description: "go 关键字让函数并发执行，却不会自动管理它的结果、错误、退出和资源。每个后台任务都必须能回答由谁创建、何时结束以及谁等待它。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Goroutine：并发、并行、启动与生命周期所有权

go 关键字让函数并发执行，却不会自动管理它的结果、错误、退出和资源。每个后台任务都必须能回答由谁创建、何时结束以及谁等待它。

## 1. 并发不等于并行

Goroutine 是由 Go Runtime 调度的执行实体，OS 线程才由操作系统调度；两者不是固定一对一。多个任务可交替推进形成并发，是否同时用多个 CPU 核取决于可运行任务、GOMAXPROCS 与实际 CPU 配额。

`go f(x)` 在调用方先求值函数与参数，然后异步执行。传入指针、Slice 或 Map 仍可能共享数据，不能因为参数按值传递就认为已隔离。

## 2. 启动后一定要等待吗

```bash
cd examples/go/core-lab
go run ./cmd/lab -case goroutine
```

```text
joined=true
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

实验用 done 通知完成，并设置一秒等待上限。main 返回会结束进程，不会默认等待其他 Goroutine；在 HTTP Handler 里启动后台函数，也不等于建立了可靠任务队列。

## 3. 所有权模型

对于请求内子任务，请求创建并等待，子任务服从同一取消预算；对于长期 Worker，进程生命周期负责启动、取消与 Join；对于持久任务，先记录数据库状态，再由独立 Worker 领取。

不要只启动一个 Goroutine 然后忽略错误。错误可返回到有界结果通道、受控 errgroup 或明确的监督循环；不要把失败藏在无关联的日志里。

## 4. 数量与资源预算

Goroutine 初始栈较小且可增长，但绝非零成本。它可能持有缓冲区、连接、锁和整个请求对象。每请求启动无限子任务，会把一个入口请求放大为下游并发洪峰。

用 Worker 上限、队列容量和拒绝策略限定资源。对 CPU 密集工作增加 Goroutine 不会凭空增加 CPU，可能只增加调度和排队。

## 5. 练习与答案

### 5.1 main 会默认等所有 Goroutine 结束吗

不会，必须显式组织等待。

### 5.2 把 Slice 作为参数传给 Goroutine 是深拷贝吗

不是，仍可能共享底层数组。

### 5.3 后台执行能替代持久任务队列吗

不能，进程崩溃会丢失尚未持久化的工作。

## 6. 参考资料

- [go 语句](https://go.dev/ref/spec#Go_statements)
- [runtime](https://pkg.go.dev/runtime)
