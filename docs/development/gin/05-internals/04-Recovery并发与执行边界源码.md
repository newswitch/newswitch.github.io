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

## 5. 沿 recovery.go 找出恢复与提交的先后

CustomRecoveryWithWriter 先安装 defer，再调用 c.Next。panic 展开到这里时检查 recover 返回值，记录相关信息，再调用恢复处理器；默认处理器使用 AbortWithStatus(500)。

若此前没有写出，这通常能提交 500；若已写出 202 和部分正文，包装层不能改写已发状态。TestRecoveryOrderAndCommittedResponse 明确对照未写路径为 500、已写路径仍为 202，且普通 after 未执行而 defer 执行。

这与 JSON Render 返回普通 error 不同：普通编码失败进入 c.Errors 与 Abort 路径，并非一定触发 panic。两套机制应分别测试，不能希望一层 Recovery 自动覆盖全部错误。

## 6. 连接已坏时，继续输出错误也可能没有意义

固定版本对某些断连类错误有特殊处理，识别后记录并 Abort，而不是假装还能把新的 500 完整发送到客户端。应用日志与客户端实际接收结果可以不同，这不必然是日志系统错误。

Recovery 的默认请求转储并非完整脱敏器：该版本只对 Authorization 做特定处理，其他 Header 等数据不应被假定已经安全。需要自定义受控日志策略，尤其注意 Cookie、查询参数与内部标识。

记录堆栈有助于定位代码，但不需要把整个请求对象和私密正文一并输出。错误样本、计数与告警可以分开管理，避免故障时放大 I/O。

## 7. 恢复后要保持失败语义和资源收敛

HTTP panic 不一定让进程退出，但当前操作可能只做了一半。事务应由其作用域回滚，锁与句柄由 defer 释放，任务状态由持久协议恢复；不能 recover 后无条件返回成功。

后台 Goroutine 需要自身的失败边界，跨 Goroutine 的 recover 不存在。即使本地恢复成功，也要通知所有者、结束相关子任务并 Join；否则服务还会留下无主等待或持续执行的工作。

OOMKill、SIGKILL、Runtime fatal 与机器故障不受这条普通恢复路径控制。可靠性最终还依赖持久状态、租约、幂等和部署恢复，而不仅是一段 defer。

## 8. 练习与答案

### 8.1 Recovery 能捕获任意后台 Goroutine panic 吗

不能，需要在对应执行栈内处理。

### 8.2 OOMKill 能靠 recover 继续运行吗

不能。OOMKill 由操作系统终止进程，不经过普通 panic 展开；资源恢复要依赖持久状态、租约和部署重启，而不是 recover。

### 8.3 每请求一个 Context 能让全局 Map 安全吗

不能，共享状态仍需同步。

## 9. 参考资料

- [Recovery 固定源码](https://github.com/gin-gonic/gin/blob/v1.12.0/recovery.go)
- [net/http](https://pkg.go.dev/net/http)
- [请求链回归](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab/internal/requestflow)
