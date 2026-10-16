---
title: "Nginx HTTP/1.1、HTTP/2、HTTP/3 请求解析、连接与流控"
sidebar_label: "15. HTTP/1.1、2、3 与流控"
sidebar_position: 15
description: "理解请求行、Header、Body、Keepalive、Chunked、HTTP/2 Stream 与流控，以及 HTTP/3/QUIC 的连接边界。"
tags: [Nginx, HTTP1, HTTP2, HTTP3, QUIC, Flow Control]
---

# Nginx HTTP/1.1、HTTP/2、HTTP/3 请求解析、连接与流控

Nginx 处理的是协议状态机，不只是 URL 转发。HTTP 版本会改变连接复用、Header 编码、并发、队头阻塞、限流计数和上游转换方式。

## 1. HTTP/1.1 请求

```text
POST /v1/chat?stream=true HTTP/1.1\r\n
Host: api.example.com\r\n
Content-Type: application/json\r\n
Content-Length: 123\r\n
\r\n
{...}
```

Nginx 依次解析请求行、Header 和可选 Body，并在对应阶段运行模块。非法字符、Header 过大、Body 超限可能在进入 Upstream 前被拒绝。

## 2. URI 的三种表示

- 请求行中的原始 Target；
- `$request_uri` 保存的原始 URI 表示；
- `$uri` 表示当前规范化 URI，可被 Rewrite 和内部重定向改变。

代理与后端对重复斜杠、百分号编码、点段和大小写理解不一致时，可能产生路由绕过。安全验证必须使用前后端组合测试。

## 3. Header 容量

```nginx
client_header_buffer_size 1k;
large_client_header_buffers 4 16k;
```

大 Cookie、JWT 和追踪 Header 会增加每个活动请求内存。配置太小产生 400/414，太大则扩大内存和滥用空间。不要为了一个异常客户端无限增大；先分析哪个 Header 增长以及是否应改用服务器端 Session。

## 4. 请求体边界

Body 长度可能由 Content-Length 或 Transfer-Encoding 表示。Nginx 解析后构造给上游的请求，不应让冲突的原始边界信息未经处理地传递。

```nginx
client_max_body_size 20m;
client_body_buffer_size 128k;
client_body_timeout 30s;
client_body_temp_path /var/cache/nginx/client_temp;
```

超出内存 Buffer 的请求体可能落临时文件。上传容量既是网络问题也是磁盘问题。

## 5. Keepalive 与 Pipelining

HTTP/1.1 默认支持持久连接，在同一连接上顺序处理多个请求。Pipelining 允许未等前一响应就发送下一请求，但响应仍按顺序，客户端支持有限；不要把它与 HTTP/2 多路复用混淆。

```nginx
keepalive_timeout 65s;
keepalive_requests 1000;
keepalive_time 1h;
```

长 Keepalive 降低握手成本但占用连接、FD 和内存。`keepalive_requests`/`keepalive_time` 也可限制单连接长期积累的资源。

## 6. Chunked 与流式

HTTP/1.1 无已知 Content-Length 时可使用 Chunked Transfer Encoding。Chunk 边界不等于应用消息边界，也不保证代理立即转发；Buffer、压缩和上游行为都会影响可见时机。

SSE 要同时检查：

- 正确 `Content-Type: text/event-stream`；
- 应用 Flush；
- Nginx/Ingress/CDN Buffer；
- Read Timeout 与心跳；
- 客户端消费速度和断线重连。

## 7. HTTP/2 结构

```text
TCP/TLS Connection
  ├─ Stream 1: HEADERS + DATA
  ├─ Stream 3: HEADERS + DATA
  └─ Stream 5: HEADERS + DATA
```

HTTP/2 把请求拆成 Frame，在一条连接中多路复用 Stream。HPACK 压缩 Header，Flow Control 同时存在连接级和 Stream 级窗口。

HTTP/2 消除了 HTTP/1.1 应用层顺序响应限制，但底层 TCP 丢包仍阻塞该连接后续字节交付。

## 8. HTTP/2 资源边界

一个连接可产生多个并发 Stream，因此：

- Connection Limit 不等于 Request Limit；
- 单客户端可用少量连接形成高并发；
- Header 解压、优先级和 Flow Control 消耗状态；
- 慢 Stream 不一定阻塞其他 Stream 的应用处理，但共享连接和窗口；
- Downstream HTTP/2 不代表 Upstream 自动使用 HTTP/2。

具体并发、Header 和 Body 指令随 Nginx 版本演进，使用前查对应版本文档并用 `nginx -T` 确认。

## 9. HTTP/2 到上游

普通 `proxy_pass` 常把请求转换为 HTTP/1.x 上游请求；gRPC 模块使用 HTTP/2 语义。不能因为客户端显示 h2 就假定后端链路也是 h2。

代理转换时要关注：

- Hop-by-Hop Header 清理；
- Host/Authority 映射；
- Trailer；
- Body Streaming 与 Flow Control；
- 错误码到 HTTP Status 的转换。

## 10. HTTP/3 与 QUIC

```text
UDP
→ QUIC：连接、可靠传输、拥塞控制、TLS 1.3
→ HTTP/3：QPACK、Stream、HTTP 语义
```

QUIC 为不同 Stream 提供独立可靠传输，避免 TCP 层跨 Stream 队头阻塞；QPACK 必须处理 Header 动态表依赖。连接 ID 支持网络路径变化，但不代表所有 NAT/LB 都能无感迁移。

Nginx 的 HTTP/3/QUIC 构建、配置和平台要求取决于版本与密码库，先检查官方版本文档和 `nginx -V`，不要把第三方补丁时代的配置直接用于当前主线。

## 11. HTTP/3 发现与回退

客户端通常先通过 HTTPS 获得 Alt-Svc，或通过 HTTPS/SVCB DNS 记录发现 HTTP/3。UDP/443 被拦截时可能回退 HTTP/2，所以页面能打开不证明 HTTP/3 正常。

```bash
curl -V
curl -v --http2 https://example.com/
curl -v --http3 https://example.com/   # 取决于构建支持
```

## 12. 协议观测

日志可加入：

```nginx
log_format protocol '$request_id $server_protocol '
                    '$ssl_protocol $ssl_cipher $status '
                    '$request_time $upstream_response_time';
```

结合 Curl、h2load、浏览器 NetLog、Tcpdump/Wireshark 和服务端 Error Log。TLS ALPN 表示协商结果，`$server_protocol` 表示 Nginx 看到的 HTTP 版本。

## 13. 故障模式

| 现象 | 重点检查 |
| --- | --- |
| HTTP/1.1 正常，HTTP/2 失败 | ALPN、h2 Listener、代理/WAF、Header |
| 单个 h2 连接所有 Stream 卡顿 | TCP 丢包、连接窗口、客户端消费 |
| HTTP/3 偶发回退 | UDP/443、QUIC LB、NAT、证书、Alt-Svc |
| 431/400 | Header 大小、非法语法、前后端解析差异 |
| 上传 413/超时 | Body 限制、临时盘、读超时、上游 Buffer |

## 14. 练习与答案

**问题：** HTTP/2 一条连接是否只占一个并发请求？

不是。一条连接可承载多个并发 Stream，连接限制与请求/Stream 限制要分别设计。

**问题：** Nginx 下游使用 HTTP/2，为什么后端日志仍显示 HTTP/1.1？

Nginx 终止下游协议并创建独立上游请求，普通 Proxy 模块可使用 HTTP/1.1 连接后端。

**问题：** 页面访问成功是否证明 HTTP/3 成功？

不证明。客户端可能已回退 HTTP/2，需要检查实际协议和 QUIC 流量。

## 15. 参考资料

- [Nginx HTTP/2 Module](https://nginx.org/en/docs/http/ngx_http_v2_module.html)
- [Nginx HTTP/3 Module](https://nginx.org/en/docs/http/ngx_http_v3_module.html)
- [RFC 9112：HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112)
- [RFC 9113：HTTP/2](https://www.rfc-editor.org/rfc/rfc9113)
- [RFC 9114：HTTP/3](https://www.rfc-editor.org/rfc/rfc9114)
