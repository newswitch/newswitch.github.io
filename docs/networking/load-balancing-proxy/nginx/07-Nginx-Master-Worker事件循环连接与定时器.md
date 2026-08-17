---
title: "Master/Worker、Event Loop、Accept、连接与定时器"
sidebar_label: "07. Master/Worker、Event Loop、Accept、连接与定时器"
sidebar_position: 7
tags: [Nginx, Master, Worker, Event Loop]
description: "从 accept 到 epoll 事件、连接对象、定时器和响应发送理解 Nginx 内核。"
---

# Master/Worker、Event Loop、Accept、连接与定时器

Master 管理配置、监听 socket 和 worker 生命周期；Worker 单线程事件循环处理连接和模块回调。

```text
listen socket ready → accept
→ ngx_connection_t + read/write events
→ protocol state machine
→ timers/red-black tree
→ epoll/kqueue wait
→ callback → response
```

## Accept

多个 Worker 共享 listen socket，accept mutex/reuseport 等策略取决于平台和配置。SYN backlog、accept queue、FD、worker_connections 和系统 limits 共同限制连接。

理论连接上限不是 `worker_processes × worker_connections` 可全给客户端，因为每次反代还占 upstream 连接，HTTP/2 多 stream 又改变关系。

## Event Loop

非阻塞 I/O 让慢连接不占线程，但模块执行的 CPU/同步系统调用会阻塞该 Worker。大正则、同步 DNS/磁盘、第三方模块或长 Lua 都会提高该 worker 连接延迟。

## 定时器

连接读写、keepalive、upstream 等超时挂入定时器结构。大量长连接增加连接对象、buffer 和 timer 成本；需按协议测内存/FD。

## 验收题

- Master 是否转发每个业务请求？
- 反向代理一请求为何可能占两个连接？
- 事件驱动为何仍怕 CPU 长任务？
- HTTP/2 如何改变连接与并发关系？

## 参考资料

- [Nginx development guide](https://nginx.org/en/docs/dev/development_guide.html)
