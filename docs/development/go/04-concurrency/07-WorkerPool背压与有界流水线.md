---
title: "Go Worker Pool、背压与有界流水线：避免队列替代内存泄漏"
sidebar_label: "07. Go Worker Pool、背压与有界流水线：避免队列替代内存泄漏"
sidebar_position: 7
description: "Worker Pool 不只是创建固定数量 Goroutine。输入、结果、取消和关闭顺序必须共同成立，否则任务量稍大就可能死锁或把内存耗尽。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Worker Pool、背压与有界流水线：避免队列替代内存泄漏

Worker Pool 不只是创建固定数量 Goroutine。输入、结果、取消和关闭顺序必须共同成立，否则任务量稍大就可能死锁或把内存耗尽。

## 1. 为什么固定 Worker 还不够

Worker 数控制正在执行的工作，队列容量控制尚未执行的工作，连接池控制依赖资源。三者独立。把所有输入先放入一个无界 Slice，再用两个 Worker 消费，并没有限制总内存。

CPU 工作、数据库写、网络等待适合的并发不同。上限应从目标吞吐、平均持有时间、依赖容量与延迟预算推导，不能机械设为 CPU 数乘十。

## 2. 基础与可取消版本

```bash
cd examples/go/core-lab
go run ./cmd/lab -case worker
```

```text
squares=[1 4 9] workers=2
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

基础演示只有三个结果，结果缓冲恰好容纳它们。不要把“先 Wait，后读结果”直接推广到大输入，否则 Worker 可能卡在发送，Wait 永远不结束。

完整可取消版本位于 `internal/demos/pipeline.go` 的 SquareAll：独立生产者关闭 jobs，固定 Worker 同时监听取消，协调者等待后关闭 results，调用方边生产边消费结果，不依赖结果总数的缓冲。

## 3. 关闭顺序与测试

```bash
cd examples/go/core-lab
go test ./internal/demos -run TestPipeline -count=1 -timeout=10s
```

测试用 1000 个任务压过小队列，验证结果未丢；另测已取消 Context 与非法 Worker 上限。结果顺序不保证，测试排序后比较，不能依赖某个 Goroutine 先运行。

输入 Slice 在函数返回前不得被调用方并发修改。示例平方运算用于有界整数输入，不是溢出检查库。

## 4. 拒绝、等待与持久化

队列满时应明确有限等待、立即拒绝还是外部持久化，而不是再启动一个 Goroutine 等空位，从而把队列转移到调度器里。

需要进程重启后保留任务时使用持久状态与租约领取。内存 Worker Pool 适合进程内计算协作，不自动提供跨进程至少一次执行与业务幂等。

## 5. 练习与答案

### 5.1 固定两个 Worker 就能处理任意大输入而内存恒定吗

不能，输入、输出和排队仍需限制。

### 5.2 先 Wait 再读取无缓冲结果会怎样

Worker 可能阻塞在发送，形成死锁。

### 5.3 队列满再起 Goroutine 等待好吗

通常只是把无界排队藏进 Goroutine。

## 6. 参考资料

- [Go pipelines](https://go.dev/blog/pipelines)
