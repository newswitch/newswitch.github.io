---
title: "Go 内存模型：happens-before、发布、数据竞争与原子操作"
sidebar_label: "02. Go 内存模型：happens-before、发布、数据竞争与原子操作"
sidebar_position: 2
description: "并发程序不能依赖“另一个函数应该已经执行完了”。同步关系决定一个 Goroutine 的写入何时对另一个可见，调度顺序猜测不是正确性证明。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go 内存模型：happens-before、发布、数据竞争与原子操作

并发程序不能依赖“另一个函数应该已经执行完了”。同步关系决定一个 Goroutine 的写入何时对另一个可见，调度顺序猜测不是正确性证明。

## 1. 什么是数据竞争

两个 Goroutine 并发访问同一内存位置，其中至少一个写入，且未由同步关系约束，就可能形成数据竞争。运行多次都成功不能证明不存在 Race，换 CPU、编译器优化或负载后可能表现不同。

happens-before 由同一 Goroutine 内的顺序和跨 Goroutine 的同步关系组合。锁解锁/加锁、Channel 发送/接收、关闭通知与原子操作等提供各自规定的关系，不是任意两个事件都自动排序。

## 2. 关闭通知发布数据

```bash
cd examples/go/core-lab
go run ./cmd/lab -case memory
```

```text
published=42
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

子 Goroutine 先写 value，再 close(done)，主 Goroutine 接收关闭信号后读取 value。这里依赖 Channel 关闭与接收之间的同步关系，而不是依赖 CPU 恰好按预期调度。

## 3. Sleep 不是同步原语

把 `time.Sleep(time.Second)` 放在读之前，不能证明写已经完成或内存访问被正确同步。volatile 风格的直觉也不适用于普通 Go 变量。

可以用 Mutex 保护一组不变量，用 Channel 转移数据所有权，用 atomic 发布简单状态。atomic 计数正确不代表“计数与余额”两个字段的一致性也正确；多字段事务需要整体协议。

## 4. Race 检测的证据范围

```bash
go test -race ./... -count=1 -timeout=60s
```

Race detector 仅覆盖实际执行路径，会增加 CPU 和内存成本，并有平台与 C 工具链要求。本机 Windows 未配置所需 C 编译器，本系列不将普通测试等同于 -race 通过；可在具备条件的 Linux CI 执行。

仍需通过所有权、锁顺序和不可变快照说明正确性。无 Race 也可能死锁、重复扣款或丢消息。

## 5. 练习与答案

### 5.1 Sleep 足够久能替代同步吗

不能，它不建立所需的发布与可见性关系。

### 5.2 没有 Race 报告等于并发逻辑正确吗

不等于，可能未覆盖路径，也可能存在非数据竞争类错误。

### 5.3 两个 atomic 字段能自动组成事务吗

不能，多字段不变量要单独设计。

## 6. 参考资料

- [Go 内存模型](https://go.dev/ref/mem)
- [Race detector](https://go.dev/doc/articles/race_detector)
