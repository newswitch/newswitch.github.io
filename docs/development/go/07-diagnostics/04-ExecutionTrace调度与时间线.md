---
title: "Go Execution Trace：从聚合热点走向调度时间线"
sidebar_label: "04. Go Execution Trace：从聚合热点走向调度时间线"
sidebar_position: 4
description: "pprof 告诉我们总体成本集中在哪里，execution trace 帮助观察任务何时运行、何时等待及如何被唤醒。两者配合，才能解释阶段性尾延迟。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Execution Trace：从聚合热点走向调度时间线

pprof 告诉我们总体成本集中在哪里，execution trace 帮助观察任务何时运行、何时等待及如何被唤醒。两者配合，才能解释阶段性尾延迟。

## 1. 时间线能回答什么

trace 记录 Runtime 事件，可观察 Goroutine、调度、GC 和系统调用等活动。CPU profile 中热点不明显时，trace 可以帮助区分长时间 runnable、同步阻塞和 GC 阶段影响。

原始事件很多，要从一个有明确时间边界的操作或请求开始。没有请求关联时，很容易把后台工作与用户慢请求混淆。

## 2. 采集并离线转换

```bash
cd examples/go/core-lab
go run ./cmd/profile -mode trace -dir out -duration 100ms
go tool trace -pprof=sched out/runtime.trace > out/sched.pprof
go tool pprof -top out/sched.pprof
```

示例在一次有限 JSON 工作量前 Start、完成后 Stop，不留下监听。PowerShell 处理二进制重定向应使用支持原生字节重定向的版本；不确定时用脚本的二进制文件输出方式，避免把 profile 当文本编码。

需要交互界面时显式运行 `go tool trace -http=127.0.0.1:6061 out/runtime.trace`，用完停止该命令。

## 3. Task、Region 与请求关联

runtime/trace 的 Task 和 Region 可以给业务阶段命名，例如 decode、load、commit；这些标记不替代 OpenTelemetry 的跨进程传播，但有助于在本进程时间线定位。

名字应低基数且脱敏，不把用户完整输入写进追踪。每请求都记录海量自定义事件会增加采样成本和文件大小。

## 4. 从观察到验证

G 长时间 runnable 可能与 CPU quota、过量并发或 Runtime 工作竞争有关；blocked 则应结合具体等待原因。先把时间范围与容器 throttling、依赖延迟和队列指标对齐，再决定调并发还是优化计算。

trace 的开销、工具格式与版本兼容性需要记录。拿一个开发环境 trace 不能证明生产慢请求根因，最好在受控相似负载下复现并比较修复前后。

## 5. 练习与答案

### 5.1 trace 与火焰图回答完全相同的问题吗

不是，前者强调事件时间线，后者常强调聚合调用成本。

### 5.2 runnable 就表示正在 CPU 上执行吗

不是，还可能在等调度。

### 5.3 本地 trace 自动形成跨服务链路吗

不会，跨进程关联需要传播协议与链路系统。

## 6. 参考资料

- [runtime/trace](https://pkg.go.dev/runtime/trace)
- [cmd/trace](https://pkg.go.dev/cmd/trace)
