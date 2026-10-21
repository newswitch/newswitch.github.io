---
title: "Go Goroutine、Mutex 与 Block profile：CPU 不忙时在等什么"
sidebar_label: "03. Go Goroutine、Mutex 与 Block profile：CPU 不忙时在等什么"
sidebar_position: 3
description: "CPU 低并不等于服务空闲。请求可能排队等待锁、连接或结果，而少量执行者持有关键资源。不同 profile 帮助把等待分成可验证的类别。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Goroutine、Mutex 与 Block profile：CPU 不忙时在等什么

CPU 低并不等于服务空闲。请求可能排队等待锁、连接或结果，而少量执行者持有关键资源。不同 profile 帮助把等待分成可验证的类别。

## 1. 三类证据

goroutine profile 展示当前执行栈快照，适合看大量请求卡在同一位置；mutex profile 聚合锁竞争相关等待，常将成本归到导致争用的释放位置；block profile 聚合 Channel、锁等同步阻塞。

这些维度不等于同一个请求的完整延迟，也不能简单把各 profile 的时间相加。采样开销与计费位置需按工具语义理解。

## 2. 有限争用实验

```bash
cd examples/go/core-lab
go run ./cmd/profile -mode mutex -dir out -duration 100ms
go run ./cmd/profile -mode block -dir out -duration 100ms
go run ./cmd/profile -mode goroutine -dir out -duration 100ms
go tool pprof -top out/mutex.pprof
go tool pprof -top out/block.pprof
```

示例四个 Goroutine 各进入临界区十次，锁内等待 1 ms，故意制造可控争用，随后全部退出。预期看到 sync.Mutex.Unlock、Lock 或相关 Runtime 路径，而不是要求固定毫秒数。

## 3. 把堆栈翻译为问题

大量 chan send：谁应该读、是否已退出；database/sql 等待：连接是否归还、事务是否太长；Mutex 等待：持锁者是否在做网络 I/O；netpoll：是空闲 Keep-Alive 还是业务超时。

仅看等待者还不够，要追踪资源持有者及其依赖。例如把 DB 池从 4 调成 400，可能从应用排队变成数据库过载。

## 4. 安全采样与回归

SetMutexProfileFraction 和 SetBlockProfileRate 会改变采样行为，生产使用应限定窗口并记录原配置。高采样率不能永久默认开启到所有高流量进程。

修复后比较同流量下的等待、吞吐和 P99，再验证取消及退出。锁竞争降了但事务重复或数据 Race 增加，不是成功优化。

## 5. 练习与答案

### 5.1 mutex profile 的热点一定是加锁那一行吗

不一定，计费常关联到导致等待的释放路径。

### 5.2 所有 netpoll 等待都是故障吗

不是，空闲连接等待本就正常。

### 5.3 扩大连接池总能降低整体延迟吗

不能，可能压垮依赖。

## 6. 参考资料

- [pprof 采样类型](https://pkg.go.dev/runtime/pprof)
- [Runtime 采样配置](https://pkg.go.dev/runtime)
