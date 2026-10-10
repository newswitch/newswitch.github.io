---
title: "Nginx Stream、TCP/UDP、TLS Preread 与 PROXY Protocol"
sidebar_label: "18. Stream 四层代理"
sidebar_position: 18
description: "从 Stream 模块理解 TCP/UDP 代理、四层负载均衡、TLS SNI 预读、PROXY Protocol、超时和故障排查。"
tags: [Nginx, Stream, TCP, UDP, TLS Preread, PROXY Protocol]
---

# Nginx Stream、TCP/UDP、TLS Preread 与 PROXY Protocol

HTTP 模块理解 URI、Header 和状态码；Stream 模块主要处理 TCP/UDP 字节流，不解析普通 HTTP 语义。数据库、MQ、SSH、TLS 透传和自定义协议常使用 Stream。

## 1. 基本 TCP 代理

```nginx
stream {
    upstream mysql_backend {
        least_conn;
        server 10.0.1.10:3306 max_fails=3 fail_timeout=10s;
        server 10.0.1.11:3306 max_fails=3 fail_timeout=10s;
    }

    server {
        listen 3306;
        proxy_connect_timeout 3s;
        proxy_timeout 10m;
        proxy_pass mysql_backend;
    }
}
```

此时 Nginx 不理解 SQL 事务、MySQL 用户或应用错误码，只知道连接、字节和超时。

## 2. Stream 与 HTTP 的差异

| HTTP | Stream |
| --- | --- |
| 按 Host/URI/Header 路由 | 按监听、地址和可预读字段路由 |
| 有 HTTP Status | 主要是连接成功、字节和会话时间 |
| 支持响应缓存 | 不提供普通 HTTP Response Cache |
| Request/Response 生命周期 | TCP Session 或 UDP Datagram |
| 可执行 L7 重试 | 连接建立阶段切换，业务重放不可见 |

Stream 建连成功后上游业务失败，Nginx 通常无法安全把会话迁移到另一后端。

## 3. TCP 超时与半关闭

```nginx
proxy_connect_timeout 3s;
proxy_timeout 10m;
proxy_half_close on;
```

`proxy_timeout` 关注连续读写间隔，不是数据库查询总时长。Half-Close 是否启用取决于应用协议：一侧发送 FIN 后另一方向可能仍需传输数据。

数据库连接池和 LB Idle Timeout 应协调，避免池中保留已被中间层关闭的 Socket。

## 4. UDP 代理

```nginx
upstream dns_backend {
    server 10.0.2.10:53;
    server 10.0.2.11:53;
}

server {
    listen 53 udp reuseport;
    proxy_timeout 5s;
    proxy_responses 1;
    proxy_pass dns_backend;
}
```

UDP 无连接，但 Nginx 为客户端/上游映射维护会话状态。`proxy_responses` 需要符合协议响应数量；多响应、单向遥测和长超时会改变状态容量。

UDP 源地址、分片、MTU、NAT 和负载均衡哈希需要单独验证。

## 5. TLS 透传

```text
Client ===== TLS Session ===== Backend
              ↑
        Nginx 只转发 TCP
```

业务证书和私钥在后端，Nginx 不解密应用数据。优点是私钥不在代理；限制是不能基于 HTTP Path/Header 做路由、WAF 或缓存。

## 6. TLS Preread

Stream SSL Preread 能在不终止 TLS 的情况下读取 ClientHello 中的部分明文字段：

```nginx
map $ssl_preread_server_name $tls_backend {
    api.example.com api_tls;
    db.example.com  db_tls;
    default         reject_tls;
}

server {
    listen 443;
    ssl_preread on;
    proxy_pass $tls_backend;
}
```

可用信息包括 SNI、ALPN 和协议版本等，具体变量取决于模块。它无法读取加密后的 HTTP Header；ECH 普及后可见 SNI 的假设也需要重新评估。

## 7. PROXY Protocol

经过四层 LB 后，后端 TCP 对端地址是代理地址。PROXY Protocol 在业务字节前传递原客户端/目标地址：

```text
PROXY TCP4 198.51.100.20 203.0.113.10 51500 443\r\n
<TLS ClientHello...>
```

接收端：

```nginx
listen 443 proxy_protocol;
```

向支持的上游发送：

```nginx
proxy_protocol on;
```

两端必须一致。普通客户端直连启用 PROXY Protocol 的端口会被当作非法；未启用的后端收到 PROXY 前缀也会协议失败。

只允许可信 LB 访问该端口，否则攻击者可以伪造 PROXY Header 地址。

## 8. Stream 访问控制

Stream 可基于地址执行 Allow/Deny，也能使用 Geo/Map 分类。它通常看不到应用用户身份，因此网络层允许不等于数据库授权。数据库仍要启用 TLS、账号、最小权限和审计。

## 9. Stream TLS 终止

Stream 也可以在 Nginx 终止通用 TLS，再代理明文或 TLS 到后端。此时证书、客户端认证和上游 TLS 分成两个独立段，原理见 [TLS 终止、透传与重新加密](../../security/tls-pki/11-TLS终止透传重新加密与端到端加密架构.md)。

## 10. 日志与指标

```nginx
log_format stream_log '$remote_addr:$remote_port '
                      '$protocol $status '
                      '$session_time $bytes_sent $bytes_received '
                      '$upstream_addr $upstream_connect_time';

access_log /var/log/nginx/stream.log stream_log;
```

TCP Stream 状态码不是 HTTP Status。结合连接数、会话时长、收发字节、Upstream Connect Time、Reset 和应用侧日志判断。

## 11. 故障模式

| 现象 | 检查 |
| --- | --- |
| 连接立即断开 | PROXY Protocol 不匹配、端口协议错误 |
| TCP 成功但 TLS 失败 | SNI 路由、后端证书、Preread、TLS 策略 |
| 长连接周期性断开 | Nginx/LB/防火墙/应用 Idle Timeout |
| UDP 有请求无响应 | `proxy_responses`、回程、MTU、上游协议 |
| 客户端 IP 全是 LB | 未传/未解析 PROXY Protocol |
| 故障后旧连接不迁移 | TCP 会话状态不会自动转移 |

## 12. 练习与答案

**问题：** TLS Preread 能否按 `/api` 路由？

不能。Path 位于 TLS 加密的 HTTP 数据中，Preread 只读取 ClientHello 中可见信息。

**问题：** Stream 代理 MySQL 后能否根据 SQL 类型选择后端？

普通 Stream 不理解 SQL 协议语义，只按连接和可用 Stream 变量转发。

**问题：** PROXY Protocol 为什么不能对公网任意客户端开放？

它允许声明源地址；若不限制可信发送端，客户端可能伪造身份绕过基于 IP 的策略。

## 13. 参考资料

- [Nginx Stream Core Module](https://nginx.org/en/docs/stream/ngx_stream_core_module.html)
- [Nginx Stream Proxy Module](https://nginx.org/en/docs/stream/ngx_stream_proxy_module.html)
- [Nginx SSL Preread Module](https://nginx.org/en/docs/stream/ngx_stream_ssl_preread_module.html)
- [PROXY Protocol](https://www.haproxy.org/download/2.8/doc/proxy-protocol.txt)
