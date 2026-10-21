---
title: "Go Goroutine 泄漏、死锁与退出诊断：先找等谁再找为什么"
sidebar_label: "08. Go Goroutine 泄漏、死锁与退出诊断：先找等谁再找为什么"
sidebar_position: 8
description: "泄漏不一定表现为 CPU 升高。大量 Goroutine 可能安静地等在 Channel、锁、连接池或网络读取上，同时持有内存和文件描述符。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Goroutine 泄漏、死锁与退出诊断：先找等谁再找为什么

泄漏不一定表现为 CPU 升高。大量 Goroutine 可能安静地等在 Channel、锁、连接池或网络读取上，同时持有内存和文件描述符。

## 1. 泄漏、慢任务与死锁

任务仍有合理生命周期且会在预算内完成，不能仅因暂时阻塞就叫泄漏；任务已失去调用方、没有退出路径却继续保留资源，才是典型泄漏。

Runtime 的 all goroutines asleep 检测只覆盖特定全局无法推进状态。HTTP Server 仍在监听时，部分请求永久卡住也未必触发全局死锁报告。

## 2. 有限阻塞实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case leak
```

```text
blocked-worker-released=true
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

实验记录 Worker 已启动，然后由创建者关闭 release，等待 done。它展示可控退出，不会为了演示泄漏而在本机留下永不结束的进程。

## 3. 用堆栈归类而非数总量

采集 goroutine profile，按相同栈聚合，再对比数量是否随请求重复增长。chan send 常提示下游不读，sync.Mutex.Lock 提示锁竞争，database/sql 等待提示连接不足或未归还，netpoll 等待可能是正常空闲连接。

需要关联请求数、活动连接、池等待、队列长度和 heap。Goroutine 数从 100 到 200 并不足以单独判定泄漏；负载回落后是否收敛更有意义。

## 4. 修复与回归

为每个阻塞点增加合理取消或超时，把关闭责任放在能够证明发送结束的所有者，返回前等待子任务。修复不能只把 Channel 扩大一百倍或每小时重启。

回归应多次运行创建/取消流程，验证所有 owned done 信号完成，再用 profile 看相同栈不再持续累积。测试自己的 Goroutine，不要要求整个进程中的第三方后台线程计数绝对恒定。

## 5. 练习与答案

### 5.1 CPU 很低能排除 Goroutine 泄漏吗

不能，泄漏常处于阻塞状态。

### 5.2 加大缓冲区能根治下游不读取吗

通常不能，只会延迟阻塞。

### 5.3 没有全局死锁报错就能证明所有请求可完成吗

不能，局部永久等待仍可能存在。

## 6. 参考资料

- [Diagnostics](https://go.dev/doc/diagnostics)
- [runtime/pprof](https://pkg.go.dev/runtime/pprof)
