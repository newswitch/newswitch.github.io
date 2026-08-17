---
title: "Worker、连接、CPU、内存、带宽与容量压测"
sidebar_position: 11
tags: [Nginx, 容量规划, Benchmark]
description: "按短连接、长连接、TLS、响应体和上游延迟规划 Nginx。"
---

# Worker、连接、CPU、内存、带宽与容量压测

## 连接

```text
downstream connections
+ upstream active/keepalive
+ listening/admin/internal
< worker_processes × worker_connections and OS FD limits
```

HTTP/1 keepalive、HTTP/2 streams、WebSocket/SSE 的换算不同。长连接主要消耗 FD、connection/buffer/timer 和 upstream slots。

## CPU/内存

TLS handshake、压缩、正则/WAF、日志和大 Header 消耗 CPU；buffer、cache keys zone、连接和请求体占内存/临时磁盘。按进程 RSS/cgroup和模块共享区测，不靠公式猜。

## 带宽

入口 + 出口 + upstream 双向，响应体通常决定。开启压缩交换 CPU；跨区代理增加成本和 RTT。网卡 PPS 在小包/高连接时也可能先饱和。

## 压测

矩阵覆盖新连接/TLS resume、keepalive、真实 URI/response、上游快慢/错误、HTTP2/gRPC/SSE、Reload/Pod drain。逐步加并发，记录 P50/P99、错误、连接、worker CPU/RSS、FD、网络和上游。

容量使用满足 SLO 的稳态点再乘故障/发布余量，不用极限 QPS。

## 验收题

- worker_connections 为什么不是客户端连接上限？
- 长连接低 QPS 仍消耗什么？
- TLS handshake 与 keepalive 如何影响 CPU？
- 为什么要在上游变慢时压测？

## 参考资料

- [Core events](https://nginx.org/en/docs/ngx_core_module.html)
