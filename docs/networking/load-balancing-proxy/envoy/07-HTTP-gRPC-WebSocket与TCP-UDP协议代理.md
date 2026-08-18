---
title: "Envoy HTTP/1.1、HTTP/2、HTTP/3、gRPC、WebSocket 与 TCP/UDP"
sidebar_label: "07. Envoy HTTP/1.1、HTTP/2、HTTP/3、gRPC、WebSocket 与 TCP/UDP"
sidebar_position: 7
description: "理解 Envoy 下游和上游协议的独立协商、转换能力、流控制和协议排障。"
tags: [Envoy, HTTP2, HTTP3, gRPC, WebSocket, TCP, UDP]
---

# Envoy HTTP/1.1、HTTP/2、HTTP/3、gRPC、WebSocket 与 TCP/UDP

Envoy 不是简单把同一份字节转发到底。HTTP 代理会分别解析 downstream/upstream 协议、Header 与 Stream；TCP Proxy 主要转发字节流；UDP 则有不同会话与超时语义。

## 1. 两段协议

```text
client -- downstream protocol/TLS/ALPN --> Envoy
Envoy  -- upstream protocol/TLS/ALPN --> service
```

两段可以不同，例如下游 HTTP/2，上游 HTTP/1.1。是否启用取决于 HCM codec、Listener/TLS ALPN、Cluster protocol options 和上游支持。不要把“Envoy 支持 HTTP/3”理解成无需 QUIC/UDP、证书和客户端验证就会自动生效。

## 2. 协议差异

| 协议 | 关键状态 | 典型风险 |
| --- | --- | --- |
| HTTP/1.1 | 连接复用、队列、chunked | 队头阻塞、错误 keepalive |
| HTTP/2 | Connection + Stream、并发与流控制 | reset、窗口、单连接故障域 |
| HTTP/3 | QUIC/UDP、Stream、迁移 | UDP 被阻断、版本/证书/回退 |
| gRPC | HTTP/2 + trailers + gRPC status | 只看 HTTP 200 漏掉业务错误 |
| WebSocket | HTTP Upgrade 后长连接 | idle timeout、排空与背压 |
| TCP | 双向字节流 | 无 L7 Route/状态语义 |
| UDP | 数据报/会话代理 | 丢包、NAT 和会话超时 |

## 3. gRPC

统计 HTTP 状态之外，还要记录 `grpc-status`、deadline、message size、reset 和流方向。客户端 Deadline、Envoy route timeout 和上游 Deadline 要形成单调递减的预算。gRPC retry 需考虑 Streaming、可重放性与业务幂等。

## 4. WebSocket 与 SSE

WebSocket 是升级后的双向长连接；SSE 是长时间 HTTP 响应。两者都需要检查 LB、Envoy 和上游的 idle timeout、连接排空、Buffer 和慢客户端。长连接数量而非 RPS 常常先决定内存和文件描述符容量。

## 5. TCP/UDP

TCP Proxy 的 Cluster 选择通常在连接级完成，不能使用 HTTP Path/Header 路由。需要 Proxy Protocol、TLS Inspector/SNI 或 Original Destination 时，在 Listener Filter/Filter Chain 层设计。UDP 无可靠重传和有序字节流，代理的会话表、空闲清理、包大小和内核 Buffer 都进入容量模型。

## 6. 排障方法

1. 明确客户端实际使用的 IP、端口、TLS、SNI、ALPN 和协议；
2. 确认命中哪个 Filter Chain/HCM/Route；
3. 查看 upstream protocol、连接池、Stream reset 和响应 flags；
4. 用协议原生客户端验证，不只用 `curl` 模拟所有场景；
5. 抓包只作为受控证据，TLS 场景结合 Envoy 日志/统计；
6. 比较直连上游和经 Envoy，避免把服务协议错误误判为代理错误。

## 7. 掌握标准

你应能独立说明两段协议如何协商，解释 HTTP/2 Stream 与连接、gRPC HTTP/业务状态、WebSocket/SSE 生命周期以及 TCP 与 HTTP Filter 的能力边界。

## 8. 参考资料 {/* #参考资料 */}

- [HTTP Connection Management](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http_connection_management)
- [HTTP/3 Overview](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http3)
