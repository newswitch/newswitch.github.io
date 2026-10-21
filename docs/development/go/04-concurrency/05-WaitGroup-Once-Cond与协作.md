---
title: "Go WaitGroup、Once 与 Cond：等待、初始化和条件通知"
sidebar_label: "05. Go WaitGroup、Once 与 Cond：等待、初始化和条件通知"
sidebar_position: 5
description: "WaitGroup 等完成，Once 等一次初始化完成，Cond 等共享状态满足条件。沿着各自的源码与同步保证理解它们，避免把等待当取消、把通知当状态或把一次性初始化当重试。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go WaitGroup、Once 与 Cond：等待、初始化和条件通知

WaitGroup 等完成，Once 等一次初始化完成，Cond 等共享状态满足条件。沿着各自的源码与同步保证理解它们，避免把等待当取消、把通知当状态或把一次性初始化当重试。

## 1. 三种协作不是同一个问题

| 原语 | 记录什么 | 不负责什么 |
| --- | --- | --- |
| WaitGroup | 尚未完成的任务数 | 返回错误、取消、限制并发 |
| Once | 某个初始化是否已经完成 | 失败重试、对象失效、关闭重建 |
| Cond | 状态改变时的等待与通知 | 保存消息、保存业务谓词、自动处理 Context |

例如启动 8 个请求，WaitGroup 只能让调用者等它们结束，不能把并发限制为 2。缓存初始化使用 Once 后，网络失败不会自动变成下一次重试；生产者通知 Cond 后，消费者仍要检查队列是否有元素。

## 2. WaitGroup 的计数与发布路径

Go 1.27.3 的 sync/waitgroup.go 用原子状态组织任务计数与等待者，另外还有测试运行时使用的标志。Add 增加任务，Done 等于 Add(-1)，减到零时唤醒 Wait。无需在应用里复制这份位布局。

传统写法必须先 Add，再启动 Goroutine。若在新 Goroutine 内才 Add，主流程可能先看到计数为零而从 Wait 返回，随后结果读写便失去预期顺序。

WaitGroup.Go 在启动之前登记任务，并在正常完成时结束登记。当前契约要求传入函数不 panic，它不是 panic 恢复容器；错误应该通过结果或错误通道返回。调用者也不能在同一 WaitGroup 的上一批 Wait 尚未结束时开始新的零计数批次。

## 3. Join 之后可读结果，Join 之前仍要防止相互覆盖

```go
values := make([]int, 8)
var wg sync.WaitGroup
for i := range values {
    wg.Go(func() { values[i] = i + 1 })
}
wg.Wait()
// 现在读取 values
```

每个任务只写不同的数组元素，调用者在 Wait 返回后读取；任务完成与 Wait 之间建立发布关系。若所有任务同时 append 到同一个 Slice，或同时修改同一个 Map，则等待结束不会倒过来修复先前的数据竞争。

结果数、失败数、退出条件也要设计。Worker 因错误提前结束却未发出结果时，调用者如果坚持接收固定数量，会永远等待。需要错误与取消协同的场景可以继续学习 Context 与 errgroup。

## 4. Once 为什么不能只靠一次 CAS

如果用 CAS 把“未初始化”改为“已初始化”，再开始运行初始化函数，第二个调用者会看见标志并提前返回，此时对象可能尚未构造完。

Go 1.27.3 的 once.go 快路径先检查 done；慢路径使用 Mutex，重新检查后执行初始化，完成时才标记 done。保证不是“只有一个人开始”，而是“Do 返回时，这次初始化已结束”。

Once.Do 的函数发生 panic 后，该 Once 仍视为已执行，后续 Do 不会自动重跑。OnceValue/OnceValues 会保存结果；若初始化 panic，则后续调用重新触发相同 panic。OnceValues 返回的错误也会缓存，因此不适合直接承担“临时依赖不可用时不断重连”。递归调用同一个 Once.Do 还会死锁。

## 5. Cond 为什么要在循环里检查谓词

```go
condition.L.Lock()
for len(queue) == 0 && !stopping {
    condition.Wait()
}
if len(queue) != 0 {
    // 在同一把锁下移除一个元素
}
condition.L.Unlock()
```

sync/cond.go 的 Wait 先登记通知序号，再释放锁并进入等待；被通知后重新获得锁，返回时仍持锁。这个登记与释放顺序避免正确协议中的“解锁与睡眠之间错过通知”。

Go 的 Cond.Wait 不会在没有 Signal/Broadcast 唤醒的情况下自行返回。这里坚持 for 并不是因为必须假定 Go 有虚假唤醒，而是因为**从被通知到重新拿锁之间，条件可能已经被其他消费者改变**。

通知不保存业务状态。Signal 发生时没有等待者，不会留下一张“未来可用通知券”；需要持久保存的是队列、ready 或 stopping 这样的谓词。修改和检查谓词必须用同一把锁。Signal/Broadcast 允许不持锁调用，但初学时把状态修改和通知放在同一临界区更容易说明协议。

## 6. 取消、初始化失败与资源退出

Cond 没有直接接收 ctx.Done 的接口。需要取消时，必须让取消逻辑取得同一把锁、修改 stopping 并 Broadcast，所有等待者在循环里检查它；同时避免每个等待者都创建永久后台通知者。一次性、可取消的完成通知通常使用 Channel 更直接。

Once 初始化返回的客户端仍需要明确谁调用 Close。Once 只保护建立过程，不保护对象后续并发使用，也不能阻止客户端在其他任务仍使用时被关闭。

服务退出时应先停止生产，发出取消，等 WaitGroup 收敛，再关闭任务依赖。仅仅调用 Wait 而不给无限等待的任务退出条件，不是优雅退出。

## 7. 运行发布、错误缓存与通知对照

```bash
cd examples/go/core-lab
go test ./internal/mechanism -run TestCoordination -v -count=1
go test ./internal/demos -run TestConditionPredicate -v -count=1
```

TestCoordination 包含四个对照：独立元素写入后 Join；8 个调用者在 Once 返回后都看到 value=42；先设置 ready 并广播，再启动等待者也不会阻塞；OnceValues 的两次调用返回同一个缓存错误，初始化计数为 1。

第二个实验不是靠 Sleep 让初始化“应该完成”；第三个实验也不是 Cond 保存了广播，而是 ready 这个共享状态已经满足条件。把状态与通知分开解释，才不会误用原语。

## 8. 练习与答案

### 8.1 WaitGroup.Go 会帮忙恢复子任务 panic 吗

不会，契约要求任务不 panic。它负责启动与完成登记，不是错误容器。业务失败应按明确错误协议返回；未恢复的子 Goroutine panic 会导致程序失败。

### 8.2 OnceValues 初始化失败后，再调用一次能重新连接吗

不能，它会复用已保存的结果和错误。需要重试、退避、失效或关闭重建时，应设计另外的状态机。

### 8.3 Go Cond 没有虚假唤醒，为什么还用 for

因为唤醒后需要重新竞争锁，其他消费者可能已先取走资源。循环检查的是业务谓词是否仍成立，而不是把通知等同于资源所有权。

## 9. 参考资料

- [WaitGroup 固定版本实现](https://github.com/golang/go/blob/go1.27.3/src/sync/waitgroup.go)
- [Once 固定版本实现](https://github.com/golang/go/blob/go1.27.3/src/sync/once.go)
- [Cond 固定版本实现](https://github.com/golang/go/blob/go1.27.3/src/sync/cond.go)
- [sync API](https://pkg.go.dev/sync)
