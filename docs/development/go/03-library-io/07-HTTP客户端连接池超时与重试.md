---
title: "Go HTTP 客户端：连接复用、阶段超时、正文关闭与重试"
sidebar_label: "07. Go HTTP 客户端：连接复用、阶段超时、正文关闭与重试"
sidebar_position: 7
description: "http.Client 是可复用的并发组件，而不是每次请求都重新创建的临时对象。稳定调用需要同时控制连接池、总预算、响应大小和写操作的未知结果。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go HTTP 客户端：连接复用、阶段超时、正文关闭与重试

http.Client 是可复用的并发组件，而不是每次请求都重新创建的临时对象。稳定调用需要同时控制连接池、总预算、响应大小和写操作的未知结果。

## 1. Client 与 Transport

Client 负责请求策略、重定向等，Transport 管理连接与协议。长期复用 Client/Transport，按可信配置建立，不要在热路径为每个请求创建新的连接池。

整体 Client.Timeout 与 Request.Context 可以限制请求生命周期；Dial、TLSHandshakeTimeout、ResponseHeaderTimeout、IdleConnTimeout 各控制不同阶段。空闲连接数量与每主机最大活动连接数不是一个参数。

## 2. 真实回环 HTTP 实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case http-client
```

```text
status=201 body=created
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

实验创建本机 httptest.Server，经真实 TCP 调用；使用 Request Context，限制读取字节数并 defer Body.Close。它不是纯 Recorder 模拟，也不代表已覆盖公网 DNS、TLS、代理和断网行为。

## 3. 关闭正文与复用

非 2xx 状态通常不是 Do 返回的网络 error，调用方要检查 StatusCode。正文需要关闭，按需要有上限地读到 EOF 才有机会复用连接；巨大或无终止正文不能为了复用而无限 drain。

下载应流式处理并校验长度/摘要。重定向可能改变目标信任边界，SSRF 防护不能只验证最初 URL；私网、环回地址及 DNS 重绑定策略需要整体设计。

## 4. 请求预算与安全重试

上游剩余时间必须覆盖连接等待、执行和响应读取，不要每层都重新授予三秒而让总时长失控。重试要有限次数、退避和抖动，并占用同一个预算。

超时不等于未执行。GET 等幂等请求与创建订单类写请求不能套用同一自动重试逻辑。业务幂等键、请求正文可重放性、服务端去重以及重试风暴保护要共同成立。

## 5. 练习与答案

### 5.1 HTTP 500 一定令 Do 返回 error 吗

通常不会，需要检查 StatusCode。

### 5.2 Body.Close 一定使连接可复用吗

不保证，还取决于正文读取、协议状态等。

### 5.3 每次重试都能重新给完整总超时吗

不应，通常共享一次业务请求的剩余预算。

## 6. 参考资料

- [http.Client](https://pkg.go.dev/net/http#Client)
- [http.Transport](https://pkg.go.dev/net/http#Transport)
