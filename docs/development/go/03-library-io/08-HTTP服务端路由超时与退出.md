---
title: "Go HTTP 服务端：Handler、路由、超时和优雅退出"
sidebar_label: "08. Go HTTP 服务端：Handler、路由、超时和优雅退出"
sidebar_position: 8
description: "Gin 建立在 net/http 之上。先理解 Server 如何接入连接并调用 Handler，才能正确配置框架的读取、写入、流式响应和退出行为。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go HTTP 服务端：Handler、路由、超时和优雅退出

Gin 建立在 net/http 之上。先理解 Server 如何接入连接并调用 Handler，才能正确配置框架的读取、写入、流式响应和退出行为。

## 1. 从连接到 Handler

http.Server 管理监听与协议，Handler 的核心方法是 ServeHTTP(ResponseWriter,*Request)。ServeMux 或 Gin 负责后续路由，业务逻辑不应该自己处理 TCP 分包。

标准 ServeMux 已支持方法和路径参数，本系列示例使用 `GET /tasks/{id}` 与 PathValue。Gin 的 `:id` 是另一套路由语法，不能混写。

## 2. 标准路由实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case http-server
```

```text
status=200 id=t1
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

这里使用 httptest.Recorder 直接执行 Handler，适合验证路由与状态，但没有创建 TCP 连接，不能验证真实超时、Keep-Alive 或客户端断开。

## 3. 超时不是一个开关

ReadHeaderTimeout 防慢请求头，ReadTimeout、WriteTimeout 与 IdleTimeout 对应不同阶段。长期 SSE 或大文件响应要重新设计写入预算，不能把普通短请求的五秒上限不加区分地应用于所有流。

Server 超时与业务 Context 是不同约束。Context 超时不会强制杀死忽略它的计算，也不能自动回滚已提交的数据库事务。ResponseWriter 的访问应由当前请求路径协调，不允许返回后继续写。

## 4. 退出顺序

收到信号后停止接流量，使用有限时间的 Shutdown 等待活动请求。Shutdown 的 Context 不能直接用已经取消的信号 Context；超时后按策略 Close。等待所有自建 Goroutine，再关闭 DB、消息客户端和观测导出器。

Hijack/WebSocket 等连接不属于普通 HTTP 排空的完整覆盖范围，需自己追踪。Kubernetes 的 readiness 摘流、终止宽限期与负载均衡传播也需要时间预算。

## 5. 练习与答案

### 5.1 Recorder 测试可以验证连接断开吗

不能，需真实 HTTP 客户端和服务端测试。

### 5.2 Context 超时会自动中止任意 Handler 吗

不会，需要业务及依赖协作取消。

### 5.3 Shutdown 能用已取消的根 Context 吗

不宜，会立即失败，应创建独立有限的排空预算。

## 6. 参考资料

- [http.Server](https://pkg.go.dev/net/http#Server)
- [ServeMux](https://pkg.go.dev/net/http#ServeMux)
