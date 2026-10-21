---
title: "Go defer panic recover 与资源关闭"
sidebar_label: "10. Go defer panic recover 与资源关闭"
sidebar_position: 10
description: "defer 管理当前函数退出时的动作，panic 展开调用栈，recover 在特定条件下停止展开。三者不应被当成自动事务系统，也不能代替普通业务错误返回。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go defer panic recover 与资源关闭

defer 管理当前函数退出时的动作，panic 展开调用栈，recover 在特定条件下停止展开。三者不应被当成自动事务系统，也不能代替普通业务错误返回。

## 1. defer 绑定的是哪次调用

执行到 defer 时会登记调用，实参通常在登记时求值；被延迟的函数按后进先出执行。闭包若在退出时再读取变量，观察到的值又可能不同。先检查资源创建成功，再登记对应 Close，避免对 nil 资源关闭。

循环里反复 defer 关闭文件会把释放延迟到整个函数结束。可以把一次处理提取为小函数，让每次迭代都有独立释放边界。数据库事务中的 defer Rollback 常作为异常兜底，成功路径仍必须检查 Commit。

以下函数需导入 fmt，用于比较立即求值与退出时读取：

```go
func showDefer() {
    n := 1
    defer fmt.Println("argument", n)
    defer func() { fmt.Println("closure", n) }()
    n = 2
}
```

先输出 closure 2，再输出 argument 1。前者在退出时读变量，后者登记时已经取得参数值。recover 则需要由同一 Goroutine 中正在展开的延迟函数直接调用；藏进另一个普通辅助函数后间接调用，不能当作等价写法。

## 2. 展开和恢复实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case defer
```

```text
last defer -> recovered
```

完整代码与断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

内部函数先登记 recover，再登记另一个 defer，panic 后先执行后登记的动作。recover 停止当前 Goroutine 的展开，不会让发生 panic 的那条语句继续执行；恢复点所在函数结束后，外层调用才可能继续。

## 3. recover 的边界

recover 需要在相应 Goroutine 的延迟调用路径中使用。HTTP 中间件无法替另一个后台 Goroutine 恢复其 panic；后台任务需要自己的失败边界和退出协议。进程被强制终止也不能保证 defer 一定执行。

Gin Recovery 可以处理相应请求栈的 panic，但若响应已经写出，不能可靠改写成全新的 JSON 错误；也不能把 panic 当作所有输入校验的正常实现方式。资源、事务和任务状态都需要显式设计。

## 4. 返回值赋值与 defer 的具体顺序

普通 return 表达式先求值并赋给返回值，再执行 defer，最后返回。命名返回值是函数内变量，因此 defer 可以修改它；未命名返回值不能靠修改同名局部变量追溯改变已经求出的返回结果。

defer f(n) 保存登记时的 n，defer 闭包则可能在退出时再读取 n。foundation-lab 的 language 实验得到 defer_order=[2,1]，同时体现延迟读取与后进先出顺序。

把重要的返回值改写隐藏在很长的 defer 中，会增加理解成本。适用于关闭错误合并等明确场景时，保持逻辑短，并用测试断言主要错误不会被覆盖。

## 5. 资源关闭必须发生在正确的生命周期内

文件创建成功后马上登记 Close，事务创建成功后登记 Rollback，锁获取后登记 Unlock；若每次迭代都持有大量资源，缩小包围函数范围，而不是等整个批次返回才释放。

bufio.Writer 还要检查 Flush，压缩 Writer 的 Close 可能写出尾部；数据库 Commit 可能失败。单纯“写了 defer”不等于检查了最终结果，更不等于持久化已经完成。

关闭错误与原始错误都重要时可用 errors.Join 保留识别能力；对外仍由业务边界决定主错误类别。进程强制终止、机器断电和 OOMKill 不能依赖 defer 清理，应由持久状态和恢复协议兜底。

## 6. recover 恢复的是哪个调用边界

panic 展开时会执行同一 Goroutine 的延迟调用。有效 recover 停止这条展开，但不会让原 panic 位置继续执行；安装恢复的函数结束后，外层调用才有机会继续。

把恢复放在每个小函数里并返回零值，可能把不完整操作伪装成成功。合理的边界通常是请求、任务执行或插件调用：记录失败、标记状态、回收资源，并决定该执行单元能否继续。

Gin 的 Recovery 是这个规则的一种应用，不会自动处理其他 Goroutine 或进程级 fatal。普通预期失败仍用 error 返回，并发任务还要 Join；恢复 panic 不能代替取消和事务协议。

## 7. 练习与答案

### 7.1 for 循环里每次 defer Close 会每轮释放吗

不会，通常等包围函数返回。大批文件或连接会一直被持有，需要缩小函数级资源范围。

### 7.2 main 中 recover 能捕获其他 Goroutine 的 panic 吗

不能跨 Goroutine 恢复。每个执行单元要有自己的失败和收敛边界。

### 7.3 有 defer Rollback 就不用检查 Commit 吗

不行。提交也可能失败，且结果可能需要进一步确认；defer 只是未成功完成时的清理兜底。

## 8. 参考资料

- [defer 与 panic 规范](https://go.dev/ref/spec#Defer_statements)
- [panic 与 recover](https://go.dev/blog/defer-panic-and-recover)
- [Go 语言规范与执行规则](https://go.dev/ref/spec)
- [配套基础实验](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab/internal/foundation)
