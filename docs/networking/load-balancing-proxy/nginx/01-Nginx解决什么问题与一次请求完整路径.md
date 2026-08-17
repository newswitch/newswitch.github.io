---
title: "Nginx 解决什么问题与一次请求完整路径"
sidebar_position: 1
tags: [Nginx, HTTP, 反向代理, Event Loop, Upstream]
description: "从 master/worker、TCP/TLS、HTTP phases、location、upstream、buffering 与日志拆解 Nginx 一次请求的完整路径。"
---

# Nginx 解决什么问题与一次请求完整路径

Nginx 可以充当静态文件服务器、反向代理、负载均衡器、TLS 终止点和四层 TCP/UDP 代理。它擅长用事件驱动 worker 处理大量并发连接，但“连接多”与“请求计算重”不是同一问题：复杂正则、同步磁盘、巨大响应、上游排队和 Lua/第三方模块都可能改变瓶颈。

## 1. 正向代理、反向代理与网关

```text
正向代理：Client → Proxy → arbitrary destination
反向代理：Client → Nginx → selected upstream service
API Gateway：反向代理 + 身份、安全、路由、限流、插件、治理控制面
```

Nginx 开源版本身是高性能代理内核；完整 API 网关还需要配置分发、租户、策略、插件治理和控制面。Higress、Envoy 生态或商业产品可能在这些层面提供更完整能力，不能只比较转发 QPS。

## 2. master/worker 进程模型

```text
master process
  ├─ read and validate configuration
  ├─ bind privileged listen sockets
  ├─ start/stop/reload workers
  └─ manage graceful upgrade/reload

worker processes
  ├─ accept connections
  ├─ event loop
  ├─ HTTP request processing
  ├─ upstream connections
  └─ response and logging
```

Worker 通常是单线程事件循环，通过 epoll 等机制监听 socket 就绪事件。它不会为每个连接创建一个线程，因此大量慢连接不会直接等于大量线程；但每个连接仍消耗文件描述符、内存和定时器，上游连接与响应缓冲也有容量成本。

Reload 时 master 读取新配置并启动新 worker，旧 worker 停止接收新连接并完成已有请求。若存在长连接、WebSocket 或慢客户端，旧 worker 可能长时间不退出；“reload 返回成功”也不代表所有请求已切到新配置。

## 3. 一次连接建立

```text
Client DNS
→ TCP SYN/SYN-ACK/ACK
→ optional TLS handshake and certificate selection
→ accept queue
→ worker accepts socket
→ read request bytes
→ parse request line and headers
```

这里已经可能发生延迟：DNS、丢包重传、SYN backlog、TLS CPU、证书链、客户端到边缘 RTT、listen queue 和 worker 调度。若 `$request_time` 很低但用户感知慢，问题可能发生在连接建立之前或响应离开 Nginx 之后。

## 4. HTTP 请求阶段与 location

概念上，请求会经过 server 选择、rewrite、access、content、log 等阶段。配置模块通过 phase handler 参与处理，具体顺序不能只按配置文件视觉顺序猜测。

```text
listen address / SNI / Host
→ select server block
→ normalize URI
→ location lookup
→ rewrite / return / auth / access / limit
→ content handler or proxy_pass
→ filters
→ access log
```

Location 匹配包含精确、前缀、正则和最长前缀等规则；`proxy_pass` 是否带 URI 还会影响转发路径重写。上线前应为每条关键 URL 做输入—期望 upstream URI 的表格测试，而不是凭肉眼审配置。

## 5. 一次反向代理请求

```text
Nginx receives request body
→ select upstream group and peer
→ reuse or create upstream connection
→ connect / TLS to upstream
→ send request headers/body
→ wait for upstream response headers
→ receive response body
→ buffering / filters / compression
→ write to downstream client
→ access log
```

时间指标要分段理解：

```text
request_time
≈ client upload + Nginx processing
 + upstream connect/wait/receive
 + client download (subject to logging point)
```

`$upstream_connect_time`、`$upstream_header_time`、`$upstream_response_time` 分别帮助定位建连、首字节和完整上游响应。一次请求重试多个 upstream 时变量可能包含多个值，不能只按单个浮点数解析。

## 6. Buffering 改变了背压边界

启用代理响应缓冲时，Nginx 可以较快读取上游响应，再按慢客户端速度发送；缓冲不足时可能落临时文件。关闭 buffering 时，慢客户端会更直接地把背压传给 upstream 连接。

```text
buffering on：保护上游连接，但消耗 Nginx 内存/临时磁盘
buffering off：适合流式响应，但上游资源随慢客户端占用更久
```

SSE、LLM token streaming、gRPC 和大文件需要分别验证，不能统一套用网页响应参数。TTFT 要看 upstream header/首个数据到达和 Nginx 是否缓冲；总生成时间与首字节不是一个 SLO。

## 7. Upstream 选择、失败与重试

Round-robin、least connections、hash 等算法只是选择起点。还要考虑：

- DNS/服务发现何时更新地址；
- keepalive 连接池是否与 upstream 并发匹配；
- connect/read/send timeout 分别保护哪个阶段；
- 哪些错误允许 `proxy_next_upstream` 重试；
- 非幂等请求重试是否造成重复写；
- 被动健康判断与主动健康检查的差别；
- 单个 worker 的连接池和全局容量如何换算。

网关重试和应用 SDK 重试叠加会形成重试放大。每一层都要设置预算、幂等条件和可观测的 attempt 标识。

## 8. 第一轮观测

建议访问日志至少包含：

```text
request_id, host, method, uri template, status,
request_length, bytes_sent, request_time,
upstream_addr, upstream_status,
upstream_connect_time, upstream_header_time, upstream_response_time
```

再关联：

- active/reading/writing/waiting connections；
- worker CPU、RSS、文件描述符、accept error；
- listen 与 upstream socket 队列、重传；
- TLS handshake 与证书错误；
- 上游实例请求、线程池/队列与应用 trace；
- 临时文件与磁盘空间。

不要把 URI 原始参数、Authorization、Cookie 或请求体直接写入日志，需做脱敏与基数治理。

## 9. 最小实验

在本地运行两个返回实例名和可控延迟的 upstream：

1. 配置 upstream 和反向代理，验证请求分配；
2. 分别模拟 connect failure、首字节慢、响应体慢；
3. 在日志中区分 connect/header/response/request time；
4. 比较 buffering on/off 对慢客户端和 upstream 占用的影响；
5. reload 配置时保留一个长连接，观察新旧 worker；
6. 对 POST 关闭不安全重试，再用幂等请求验证有限重试。

## 10. 验收问题

- master 与 worker 分别负责什么，reload 为什么会同时存在新旧 worker？
- 一次请求如何从 listen/SNI/Host 到 server 和 location？
- upstream connect、header、response 与 request time 分别表示什么？
- Buffering 为什么会改变慢客户端对上游的影响？
- Nginx CPU 不高但 TTFT 超标，可能在哪些连接、队列和上游阶段？
- 网关与 SDK 同时重试为什么危险？

## 11. 参考资料

- [Nginx 官方文档](https://nginx.org/en/docs/)
- [Nginx 请求处理](https://nginx.org/en/docs/http/request_processing.html)
- [HTTP proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Nginx 控制信号与 Reload](https://nginx.org/en/docs/control.html)
