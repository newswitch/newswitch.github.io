---
title: "Go Mutex、RWMutex 与 atomic：保护不变量而不是单行代码"
sidebar_label: "04. Go Mutex、RWMutex 与 atomic：保护不变量而不是单行代码"
sidebar_position: 4
description: "锁的保护对象是共享状态及其约束。只把某一行包进 Lock/Unlock，可能消除一个 Race，却仍留下检查与执行之间的竞态。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Mutex、RWMutex 与 atomic：保护不变量而不是单行代码

锁的保护对象是共享状态及其约束。只把某一行包进 Lock/Unlock，可能消除一个 Race，却仍留下检查与执行之间的竞态。

## 1. 临界区应该覆盖什么

例如库存必须大于零才能扣减，检查与扣减需要在同一临界区内完成。先锁读取，再解锁判断，再锁扣减，会让两个请求都基于旧库存通过检查。

Mutex 的零值可用，使用后不要复制包含锁的对象；常见做法是用指针接收者，并用 go vet 检查 copylocks。Go Mutex 不支持递归加锁，锁顺序相反也可能造成死锁。

## 2. 计数实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case mutex
```

```text
mutex=400 atomic=400
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

四个 Goroutine 各递增一百次，Mutex 保护普通变量，atomic.Int64 独立计数。两种路径都成立，但这不意味着所有结构体都能逐字段换成 atomic。

## 3. RWMutex 与 atomic 的边界

RWMutex 允许多个读者，但写者需要独占；读占比高不代表必然更快，还取决于临界区长度、竞争、缓存一致性和写者等待。不能在持有 RLock 时直接升级为 Lock。

atomic.Value 或 atomic.Pointer 可发布不可变快照，发布后不得再无锁修改快照内部的 Map/Slice。原子指针交换只保证指针层面的原子性，不自动保护对象内容。

## 4. 缩短持锁路径

不要在锁内执行不可控网络请求、长磁盘 I/O 或等待另一个需要同一锁的 Goroutine。可在锁内取快照和版本，锁外执行，再按版本条件提交，但必须处理快照过期。

性能排查用 mutex/block profile 判断等待和持锁来源；不能仅因为 CPU 低就认为没有锁瓶颈。

## 5. 练习与答案

### 5.1 atomic 指针指向 Map 后就能无锁修改吗

不能，原子发布不保护后续内部修改。

### 5.2 RWMutex 一定优于 Mutex 吗

不一定，必须测量真实读写比例和争用。

### 5.3 锁结构体可以按值复制吗

使用后不应复制，可能破坏同步协议。

## 6. 参考资料

- [sync](https://pkg.go.dev/sync)
- [sync/atomic](https://pkg.go.dev/sync/atomic)
