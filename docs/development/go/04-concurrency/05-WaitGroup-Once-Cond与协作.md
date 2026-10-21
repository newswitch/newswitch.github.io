---
title: "Go WaitGroup、Once 与 Cond：等待、初始化和条件通知"
sidebar_label: "05. Go WaitGroup、Once 与 Cond：等待、初始化和条件通知"
sidebar_position: 5
description: "等待完成、只执行一次和等待状态改变，是三类不同协作问题。选对原语能让生命周期清楚，选错则容易丢通知、重复初始化或提前退出。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go WaitGroup、Once 与 Cond：等待、初始化和条件通知

等待完成、只执行一次和等待状态改变，是三类不同协作问题。选对原语能让生命周期清楚，选错则容易丢通知、重复初始化或提前退出。

## 1. WaitGroup 不负责返回错误

WaitGroup 管理一组工作的完成计数，不收集结果、不传播取消、不限制并发。传统 Add 必须在可能 Wait 之前建立计数，不能让新 Goroutine 内部晚到的 Add 与 Wait 竞争。

当前版本提供 WaitGroup.Go，可简化启动与完成配对；其函数不应 panic。复用 WaitGroup 时需确保上一批 Wait 已结束，不能随意跨越批次边界。

## 2. Once 实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case sync
```

```text
once=1
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

多个 Goroutine 调用同一 Once.Do，初始化函数只执行一次，其他调用等待其完成。但 Once 不是“失败后自动重试”：函数 panic 或返回业务失败的策略要按 API 行为处理，不能假定下一次 Do 会重跑。

## 3. Cond 等待的是谓词

```go
lock.Lock()
for !ready {
    condition.Wait()
}
// 此处在锁内使用已成立的状态
lock.Unlock()
```

Cond.Wait 在等待时释放关联锁，唤醒后重新取得锁。必须循环检查谓词，因为通知只表示“状态可能改变”，其他消费者可能先取走资源。修改 ready 与检查 ready 应使用同一把锁。

完整并发实验见 core-lab 的 TestConditionPredicate：先通知后等待也不会丢失 ready 状态。Cond 没有内建 Context 取消，复杂可取消等待常用 Channel 更直接。

## 4. 错误与资源初始化

对数据库、客户端和配置缓存的一次性建立，要把成功状态与错误返回明确暴露。OnceValue/OnceValues 可简化惰性值，但并不替你实现按时间失效、失败退避或关闭重建。

Once 保护初始化，不保护返回对象之后的并发修改。WaitGroup 等待 Worker 结束，也不代表它们的数据库事务都已成功。

## 5. 练习与答案

### 5.1 WaitGroup 限制并发数吗

不限制，需要信号量或固定 Worker。

### 5.2 Cond 收到通知就能省略状态检查吗

不能，应持锁循环检查谓词。

### 5.3 Once 初始化失败后会自动重试吗

不会，应另建明确的重试状态机。

## 6. 参考资料

- [sync.WaitGroup](https://pkg.go.dev/sync#WaitGroup)
- [sync.Once](https://pkg.go.dev/sync#Once)
- [sync.Cond](https://pkg.go.dev/sync#Cond)
