---
title: "Go Goroutine、Channel 与内存模型"
sidebar_label: "03. Goroutine、Channel 与内存模型"
sidebar_position: 3
description: "理解 Happens-before、数据竞争、Channel 所有权、WaitGroup、关闭规则、背压和 Goroutine 泄漏。"
tags: [Go, Goroutine, Channel, Memory Model, Concurrency]
---

# Go Goroutine、Channel 与内存模型

启动 Goroutine 很便宜，不代表可以无限启动。每个 Goroutine 都必须回答：谁创建、怎样停止、谁等待、失败怎样传播。

## 1. 数据竞争

两个 Goroutine 并发访问同一内存且至少一个写入，没有同步关系时即存在数据竞争。结果不只是“值偶尔不对”，程序行为不再可靠。

```bash
go test -race ./...
```

Race Detector 只能发现本次执行覆盖到的竞争，不是形式证明。

## 2. Channel 所有权

```go
jobs := make(chan Task, 32)
results := make(chan Result, 32)
```

- 创建者决定缓冲容量。
- 发送方负责关闭 Channel。
- 接收方不关闭未知发送者仍可能使用的 Channel。
- 关闭表示不会再有值，不是广播任意状态对象。

向已关闭 Channel 发送会 Panic；从已关闭 Channel 读取返回零值和 `ok=false`。

## 3. Worker 收敛

```go
var wg sync.WaitGroup
for i := 0; i < workers; i++ {
	wg.Add(1)
	go func() {
		defer wg.Done()
		for task := range jobs {
			results <- run(task)
		}
	}()
}

go func() {
	wg.Wait()
	close(results)
}()
```

生产实现还要让发送结果响应 Context，否则消费者退出后 Worker 可能永久阻塞。

## 4. 背压

有界 Channel 满时发送者阻塞，形成背压。容量不是越大越好：它决定等待内存和任务过期时间。监控队列长度、最老任务年龄和拒绝数。

## 5. Select 与取消

```go
select {
case jobs <- task:
case <-ctx.Done():
	return ctx.Err()
}
```

所有可能阻塞的发送、接收和外部调用都要考虑取消。`default` 会把阻塞变为忙轮询或丢弃，只有明确需要非阻塞语义时使用。

## 6. Mutex 与 Channel

- Mutex 适合保护共享内存不变量。
- Channel 适合传递所有权和任务流。
- Atomic 适合很小且语义清晰的计数/状态。

不要为了口号把所有共享状态都改成复杂 Channel 网络。

## 7. 泄漏检查

常见泄漏：无人读取结果、永不返回的 I/O、Ticker 未停止、Context 未取消、WaitGroup 计数错误。通过 Goroutine Profile、测试超时、指标和关闭演练发现。
