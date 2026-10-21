---
title: "Gin 源码：Recovery、并发请求与无法恢复的边界"
sidebar_label: "04. Gin 源码：Recovery、并发请求与无法恢复的边界"
sidebar_position: 4
description: "Recovery 可以把当前请求栈中的部分 panic 转为受控失败，但它不是进程级防崩溃结界。理解执行栈与响应状态，才能把稳定性建立在正确边界。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 源码：Recovery、并发请求与无法恢复的边界

Recovery 可以把当前请求栈中的部分 panic 转为受控失败，但它不是进程级防崩溃结界。理解执行栈与响应状态，才能把稳定性建立在正确边界。

## 1. Recovery 如何生效

Recovery 中间件在调用后续 Handler 前安装 defer，在同一 Goroutine 的 panic 展开时 recover，记录必要信息并选择处理方式。它必须包围可能 panic 的后续执行路径。

输入错误、业务冲突和依赖超时应正常返回 error，不应用 panic 代替常规控制流。否则堆栈噪声与响应语义都会失控。

## 2. 有限 panic 实验

```bash
cd examples/gin/service-lab
go run ./cmd/webdemo -case recovery
```

```text
status=500
```

完整代码与断言见 [service-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab)。

示例在尚未写正文的当前请求栈抛出受控 panic，Recovery 返回 500。该输出不是对“所有 panic 都能变成干净 500”的保证，部分内容已写、连接损坏和后台 Goroutine 都有不同边界。

## 3. 并发请求共享什么

net/http 可并发调用同一 Engine，路由与配置大多是启动后共享数据，服务对象和 DB 池也共享。每请求的 Context 不代表 Handler 闭包引用的 Map 或计数器自动安全。

后台 Goroutine 的 panic 不会被另一个 Goroutine 的 defer recover 捕获。真正需要隔离的 Worker 应在自身边界管理错误、必要的恢复与状态补偿，不能无脑 recover 后继续当作成功。

## 4. 进程与容器故障

OOMKill、某些 Runtime fatal error、SIGKILL 和机器断电不属于普通 recover 范围。可靠服务需要持久状态、租约恢复、重试去重与部署层重启策略。

Recovery 日志也要脱敏，不能默认打印所有 Header、Cookie 或正文。错误采样、堆栈保存与告警应按风险设置，避免一次外部非法输入产生大量敏感日志。

## 5. 练习与答案

### 5.1 Recovery 能捕获任意后台 Goroutine panic 吗

不能，需要在对应执行栈内处理。

### 5.2 OOMKill 能靠 recover 继续运行吗

不能。

### 5.3 每请求一个 Context 能让全局 Map 安全吗

不能，共享状态仍需同步。

## 6. 参考资料

- [Recovery 固定源码](https://github.com/gin-gonic/gin/blob/v1.12.0/recovery.go)
- [net/http](https://pkg.go.dev/net/http)
