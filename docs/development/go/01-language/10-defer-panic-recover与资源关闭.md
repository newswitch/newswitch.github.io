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

## 4. 练习与答案

### 4.1 for 循环里每次 defer Close 会每轮释放吗

不会，通常等包围函数返回。大批文件或连接会一直被持有，需要缩小函数级资源范围。

### 4.2 main 中 recover 能捕获其他 Goroutine 的 panic 吗

不能跨 Goroutine 恢复。每个执行单元要有自己的失败和收敛边界。

### 4.3 有 defer Rollback 就不用检查 Commit 吗

不行。提交也可能失败，且结果可能需要进一步确认；defer 只是未成功完成时的清理兜底。

## 5. 参考资料

- [defer 与 panic 规范](https://go.dev/ref/spec#Defer_statements)
- [panic 与 recover](https://go.dev/blog/defer-panic-and-recover)
