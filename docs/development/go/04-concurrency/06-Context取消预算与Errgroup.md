---
title: "Go Context、取消预算与 errgroup：让子任务一起收敛"
sidebar_label: "06. Go Context、取消预算与 errgroup：让子任务一起收敛"
sidebar_position: 6
description: "Context 传递截止时间、取消信号和少量请求范围元数据，不是一个强制终止线程的开关。结构化并发要求子任务有归属、错误可见并能被等待。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Context、取消预算与 errgroup：让子任务一起收敛

Context 传递截止时间、取消信号和少量请求范围元数据，不是一个强制终止线程的开关。结构化并发要求子任务有归属、错误可见并能被等待。

## 1. 取消传播而非强制打断

从父 Context 派生 WithTimeout/WithCancel，父取消会传播给后代，子取消不反向取消父。必须调用 cancel 释放相关资源，即使业务提前成功。

Context 通常作为函数第一个参数传递，不要随意藏在可复用服务结构体里。Value 只放请求范围元数据，不承载数据库、可选参数列表或凭证全集。

## 2. 取消原因实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case context
```

```text
cancelled=true cause=shutdown
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

ctx.Err 给出通用取消类别，context.Cause 可保留更具体原因。只有接收 Done 或把 Context 传到支持取消的 I/O，子任务才会停止；纯 CPU 循环需要主动检查。

## 3. errgroup 的使用契约

golang.org/x/sync/errgroup 的 WithContext 将首个失败关联到组取消，Wait 等待所有任务退出并返回错误。SetLimit 可限制活动任务数，但排队调用 Go 也可能阻塞；必须设计好准入顺序，不能把所有数量控制都推给一个库。

典型顺序是派生 group/ctx → 设置上限 → 每个任务使用派生 ctx → 业务错误直接返回 → 最后 Wait。不要在所有任务里都用 context.Background，否则组取消失去作用。核心实验无第三方依赖，未把 errgroup 库行为冒充为已执行的标准库实验。

## 4. 预算与提交边界

一次三秒请求中，排队、连接、SQL 和响应读取共享剩余预算；重试不能无限刷新截止时间。取消后数据库写可能已经提交，远程接口也可能完成，必须按操作语义确认结果。

可靠后台任务不能直接继续使用已经结束的 HTTP Context。应先持久化接收结果，再让进程级 Worker 使用自己的有限执行预算；这与无期限 Background 完全不同。

## 5. 练习与答案

### 5.1 取消会回滚已经提交的事务吗

不会，提交状态需按数据库结果确认。

### 5.2 子任务用 Background 还能收到父取消吗

不能，除非另建明确传播机制。

### 5.3 Wait 返回前所有任务都应结束吗

结构化并发要求如此，但忽略取消的任务仍可能拖住 Wait。

## 6. 参考资料

- [context](https://pkg.go.dev/context)
- [errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup)
