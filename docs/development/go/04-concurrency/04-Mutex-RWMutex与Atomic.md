---
title: "Go Mutex、RWMutex 与 atomic：保护不变量而不是单行代码"
sidebar_label: "04. Go Mutex、RWMutex 与 atomic：保护不变量而不是单行代码"
sidebar_position: 4
description: "锁应该保护一组始终成立的状态，而不是任意一行赋值。从 Mutex 快慢路径、RWMutex 写者等待到不可变 atomic 快照，理解正确性与性能各由什么决定。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Mutex、RWMutex 与 atomic：保护不变量而不是单行代码

锁应该保护一组始终成立的状态，而不是任意一行赋值。从 Mutex 快慢路径、RWMutex 写者等待到不可变 atomic 快照，理解正确性与性能各由什么决定。

## 1. 先说清楚被保护的不变量

两个账户的总额必须保持不变时，扣减、增加以及读取合计必须使用同一套同步协议。只给两次写各加一把锁，或者分别改成 atomic.Add，都不能阻止读者看到中间状态。

临界区覆盖的对象、方法和读取方式要一致。最容易遗漏的是调试接口、缓存刷新和序列化方法直接读取字段。使用锁的类型通常以指针传递，Mutex、RWMutex 以及 atomic 类型在开始使用后都不能随意复制。

Mutex 不可重入；同一个 Goroutine 已持锁时再次 Lock 会阻塞。它也不保证绑定某个 Goroutine，所以允许明确安排的跨 Goroutine 解锁，但普通业务最好由同一段调用路径成对管理。

## 2. 从公共 API 找到真正的 Mutex 实现

Go 1.27.3 的 sync/mutex.go 包装 internal/sync.Mutex。底层主要是 state 与 sema：state 表示已锁、已唤醒、饥饿及等待者信息；sema 用于等待与唤醒，不是业务计数器。

| 路径 | 做的事情 | 对应用的意义 |
| --- | --- | --- |
| Lock 快路径 | CAS 从未锁状态改为已锁 | 无争用时无需进入完整等待流程 |
| lockSlow | 按条件短暂自旋，失败后登记并等待 | 不是所有等待都持续占用 CPU |
| 正常模式 Unlock | 唤醒等待者参与竞争 | 被唤醒者不保证立刻拿到锁 |
| 饥饿模式 | 向队列前面的等待者交接 | 用吞吐换取尾部等待的改善 |

该版本用约 1 ms 的等待阈值参与饥饿模式判断，但这不是“锁保证 1 ms 内到手”的 SLA。何时运行、临界区持续多久、CPU 配额和竞争量都会影响实际等待；不要把内部阈值写成调优参数。TryLock 失败也不建立所需同步，不能失败后直接读取受保护数据。

## 3. RWMutex 为什么可能让读者一起等待

RLock 允许多个读者，但不允许读者修改共享状态。Go 1.27.3 的 rwmutex.go 维护 readerCount、readerWait 和等待信号量。写者先与其他写者互斥，再宣布有待处理写入，等待既有读者退出；新的读者需要等待写者完成。

因此下面的想法有风险：持有 RLock 时调用一个内部还会 RLock 的方法。若期间有写者等待，第二次 RLock 可能被阻塞，而写者又在等第一次 RUnlock，形成死锁。也不能拿着 RLock 升级成 Lock。

读多不等于 RWMutex 一定更快。很短的临界区、读计数器竞争、频繁写入和 CPU 数都会改变结果。需要相同业务操作的并行 Benchmark，加上 Mutex/Block profile；不要只比较“加锁空循环”。

## 4. 用确定交错验证 atomic 不等于事务

```bash
cd examples/go/core-lab
go run ./cmd/mechanism-lab -mode locks
```

```json
{"mixed_atomic_total":99,"final_atomic_total":100,"mutex_invariant":true,"snapshot_consistent":true,"input_isolated":true}
```

实验用 Channel 固定“扣减后、增加前”的观察点，两个 atomic 余额得到合计 99，最终恢复 100。它没有数据竞争，只是不满足一致快照。Mutex 对照组用 4 个 Worker 各执行 1000 次转移，更新和读取都受同一把锁保护，始终保持总额 2000。

测试结果证明这个实现满足被测不变量，不证明所有使用 Mutex 的代码都正确。若读取路径绕过锁，这个保证就不成立。

## 5. atomic.Pointer 的正确用法是发布不可变快照

配置热更新常适合“构造新对象，最后一次发布”：先完整校验版本与 Map，再 atomic.Pointer.Store；读者 Load 一次，从同一对象读版本与内容。

mechanism/concurrency.go 中的 configStore 在发布前 maps.Clone 输入，发布后不再修改，也不把 Map 交给外部写。测试在 publish 返回后修改原输入，已发布值不受影响；并发读者读取的 version 与 requests 始终一致。

这仍是浅复制：Map 的值若含 Slice 或指针，必须继续处理内部别名。旧快照由仍持有它的读者保留，引用消失后再由 GC 回收。高频发布大对象会增加分配与保留成本；有多个写者需要“基于旧值修改”时，还要用写锁或 CAS 重试防止更新覆盖，单纯 Store 只提供最后一次发布生效。

## 6. 缩短临界区，不是把锁机械挪到外面

慢 HTTP、数据库查询、日志阻塞或等待另一个 Channel 都不适合随意放在锁内，否则一个慢请求会扩散为所有调用者等待。

但把“读取旧余额、解锁、调用依赖、重新加锁提交”直接拆开，也可能提交过期决策。常见安全方式是在锁内取得版本与必要快照，锁外计算，提交时再次比较版本；冲突则重试或返回明确错误。

Mutex.Lock 没有 Context 参数。不要为了支持超时，临时创建一个 Goroutine 等锁、调用者超时后直接离开，这会把等待者与后续解锁责任遗留在后台。先限制进入这个区域的并发，并缩短受保护操作。

## 7. 从等待证据定位锁问题

```bash
go test ./internal/mechanism -run TestLockInvariants -v -count=1
go run ./cmd/profile -mode mutex -dir out -duration 100ms
go run ./cmd/profile -mode block -dir out -duration 100ms
go tool pprof -top out/mutex.pprof
go tool pprof -top out/block.pprof
```

Mutex profile 主要归因造成争用的持锁路径，Block profile 展示阻塞位置；采样设置和聚合规则不同，不能把两个总时长直接相加。CPU 不高但锁等待高时，先找持锁者在做什么，再决定拆锁、分片或不可变快照。

若多个锁必须同时取得，为它们规定全局顺序。优化后回归业务不变量、取消路径和并发吞吐，而不只看平均耗时下降。

## 8. 练习与答案

### 8.1 为什么 Mutex 的 1 ms 阈值不是拿锁时间上限

它是固定版本实现中的模式切换依据，不是调度承诺。等待者还受持锁时间、其他竞争者和 CPU 调度影响。

### 8.2 只在 atomic.Pointer 外层安全发布，内部 Map 就能继续更新吗

不能。指针发布不会让普通 Map 的后续并发修改变安全。需要发布后不可变，或对内部修改使用独立同步协议。

### 8.3 RLock 内再次 RLock 为什么也可能死锁

写者等待时会阻止新的读者进入，第二次 RLock 可能等待写者；写者又等待第一次 RUnlock，双方互等。

## 9. 参考资料

- [sync.Mutex 与 RWMutex API](https://pkg.go.dev/sync)
- [atomic.Pointer API](https://pkg.go.dev/sync/atomic#Pointer)
- [Go 1.27.3 Mutex 内部实现](https://github.com/golang/go/blob/go1.27.3/src/internal/sync/mutex.go)
- [Go 1.27.3 RWMutex 实现](https://github.com/golang/go/blob/go1.27.3/src/sync/rwmutex.go)
