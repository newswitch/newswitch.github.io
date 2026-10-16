---
title: "SNI、ALPN、HTTPS、HTTP/2、HTTP/3 与 QUIC 的关系"
sidebar_label: "12. SNI、ALPN 与 HTTP 协议"
sidebar_position: 12
description: "厘清域名选择、证书选择、应用协议协商，以及 HTTP/2 over TLS 和 HTTP/3 over QUIC 的边界。"
tags: [SNI, ALPN, HTTP2, HTTP3, QUIC, HTTPS]
---

# SNI、ALPN、HTTPS、HTTP/2、HTTP/3 与 QUIC 的关系

SNI 和 ALPN 都在 TLS 握手中出现，但解决的问题不同：SNI 表示想访问哪个服务名，ALPN 协商 TLS 之上运行哪个应用协议。

## 1. SNI

多个域名可共享同一个 IP：

```text
203.0.113.10
  ├─ api.example.com → api certificate / api route
  └─ web.example.com → web certificate / web route
```

客户端在 ClientHello `server_name` 扩展发送目标 DNS 名，服务端据此选择证书和虚拟主机。旧客户端不发送 SNI 时只能得到默认配置。

SNI 选择证书不等于证书验证。服务端即使选择了某张证书，客户端仍需确认 SAN 匹配最初访问名称。

## 2. ALPN

客户端发送支持列表：

```text
h2, http/1.1
```

服务端选择其中一个并在 EncryptedExtensions 返回。若没有共同协议，可失败或按具体应用策略处理。常见标识：

| ALPN | 协议 |
| --- | --- |
| `http/1.1` | HTTP/1.1 |
| `h2` | HTTP/2 over TLS |
| `h3` | HTTP/3 over QUIC |

## 3. HTTP/2

公网浏览器通常通过 TLS + ALPN 协商 `h2`：

```text
TCP → TLS → ALPN h2 → HTTP/2 Frames
```

HTTP/2 在一条连接内多路复用 Stream，但底层 TCP 丢包仍可能阻塞该连接中后续字节的交付。

## 4. HTTP/3 与 QUIC

HTTP/3 不运行在传统 TLS-over-TCP 上：

```text
UDP
  → QUIC（集成 TLS 1.3 握手、可靠性、拥塞控制、多路复用）
  → HTTP/3
```

QUIC 对 TLS 1.3 有专门映射，TLS Record Layer 不按 TCP 模式使用。各 Stream 的传输阻塞相互独立性更好，但 UDP 可达性、中间设备、连接迁移和 QUIC 实现成为新的排障层。

## 5. DNS 与 Alt-Svc

客户端可能先通过 HTTPS 获得 `Alt-Svc`，或通过 HTTPS/SVCB 记录发现 HTTP/3 能力。HTTP/3 失败时可能回落 HTTP/2，因此“页面正常”不代表 HTTP/3 成功。

## 6. 直接访问 IP 的问题

```bash
curl https://192.0.2.10/
```

这会影响：

- SNI 可能是 IP 或缺失；
- 虚拟主机选择错误；
- 证书通常没有匹配的 IP SAN；
- HTTP Host 与正常域名不同。

测试指定 IP 但保持真实域名应使用：

```bash
curl --resolve api.example.com:443:192.0.2.10 \
  https://api.example.com/
```

它同时保留 URL 主机名、SNI、Host 和证书主机名验证。

## 7. 验证协商结果

```bash
openssl s_client -connect api.example.com:443 \
  -servername api.example.com \
  -alpn 'h2,http/1.1' </dev/null
```

```bash
curl -v --http2 https://api.example.com/
curl -v --http3 https://api.example.com/   # 取决于 Curl 构建能力
```

不要假设系统安装的 Curl 一定编译了 HTTP/2/3 支持，先检查：

```bash
curl -V
```

## 8. 练习与答案

**问题：** 修改 HTTP Host Header 能否完全模拟 HTTPS 虚拟主机？

不能。证书选择发生在 HTTP Header 之前，需要正确 SNI；证书验证还使用 URL 目标名称。

**问题：** 抓到 UDP/443 是否足以证明 HTTP/3 成功？

不足。还要确认 QUIC/TLS 握手和 ALPN `h3` 成功，并查看应用响应；UDP/443 也可能只是失败尝试。

## 9. 参考资料

- [RFC 6066：SNI](https://www.rfc-editor.org/rfc/rfc6066)
- [RFC 7301：ALPN](https://www.rfc-editor.org/rfc/rfc7301)
- [RFC 9001：Using TLS to Secure QUIC](https://www.rfc-editor.org/rfc/rfc9001)
- [RFC 9114：HTTP/3](https://www.rfc-editor.org/rfc/rfc9114)
