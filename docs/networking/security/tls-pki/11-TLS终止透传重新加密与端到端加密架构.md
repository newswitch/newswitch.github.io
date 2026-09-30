---
title: "TLS 终止、透传、重新加密与端到端加密架构"
sidebar_label: "11. TLS 部署架构"
sidebar_position: 11
description: "比较网关 TLS 终止、L4 透传、后端重新加密、双向 TLS 及其明文边界和证书位置。"
tags: [TLS Termination, TLS Passthrough, Re-encryption, mTLS, 网关]
---

# TLS 终止、透传、重新加密与端到端加密架构

部署 TLS 时最先要画的不是配置文件，而是每条连接的 TLS 端点。代理加入后，客户端到后端可能是两条独立连接，不存在一把密钥贯穿整个系统。

![TLS 终止、重新加密、透传与 mTLS](/img/networking/tls-pki/tls-deployment-modes.svg)

## 1. TLS 终止

```text
Client ==TLS A==> Gateway ----HTTP----> Backend
                   ↑
             server.key/cert
```

优点：网关可读取 HTTP、做路由、WAF、认证、压缩和指标。缺点：网关到后端是明文，必须由可信网络边界、隔离和访问控制补偿。

## 2. TLS 重新加密

```text
Client ==TLS A==> Gateway ==TLS B==> Backend
                 cert A       cert B
```

TLS A 与 TLS B 独立：

- 独立握手和流量密钥；
- 可以使用不同 CA、SNI、ALPN 和协议版本；
- 网关既是下游服务端，又是上游客户端；
- 上游验证失败不能用关闭验证代替修复。

外部证书证明公网域名，内部证书可证明服务身份。两段都加密不等于客户端与后端之间密码学端到端，因为网关仍看到明文。

## 3. TLS 透传

```text
Client ================= TLS =================> Backend
                L4 Gateway 只转发 TCP
```

证书私钥在后端，网关通常只能基于目标地址、端口和 ClientHello 可见信息（如 SNI）选路，不能读取加密后的 HTTP Path/Header。优点是网关不持有业务私钥；缺点是 L7 治理、WAF、Header 路由和统一证书卸载能力受限。

## 4. 双向 TLS

mTLS 可以用于任一 TLS 段：

```text
Client ==server cert + client cert==> Gateway
Gateway ==internal client cert======> Backend
```

两段客户端身份也可能不同。后端通常看到的是网关身份，而不是原始终端证书；若需要传递原始身份，必须设计受保护的身份上下文并防止客户端伪造 Header。

## 5. 边缘 CDN 和负载均衡器

常见链路：

```text
Browser ==TLS==> CDN ==TLS==> Cloud LB ==TLS==> Ingress ==mTLS==> Service
```

每一段都需要回答：

- 谁验证谁；
- 使用哪个名称和 CA；
- 证书由谁轮换；
- 明文出现在哪里；
- 错误和指标在哪里观察；
- 原始客户端 IP/协议怎样可信传递。

## 6. 证书放置矩阵

| 模式 | 网关私钥 | 后端私钥 | 网关上游 CA | 网关能读 HTTP |
| --- | --- | --- | --- | --- |
| 终止 + HTTP | 需要 | 不需要 TLS 私钥 | 不需要 | 能 |
| 重新加密 | 需要 | 需要 | 需要 | 能 |
| 透传 | 不需要业务私钥 | 需要 | 不适用 | 不能 |
| 网关到后端 mTLS | 下游及上游客户端私钥 | 需要 | 需要 | 能 |

## 7. 不能混淆的“端到端”

工程文档中的“端到端加密”可能表示：

1. 每一跳都有 TLS；
2. 客户端 TLS 一直终止在业务 Pod；
3. 应用层内容只有最终业务端点可解密。

三者保护边界不同，应在架构图中写出终止点，避免只用一个口号。

## 8. 选择方法

- 需要 L7 路由/WAF：终止或重新加密；
- 私钥必须留在业务端：透传；
- 内网不可信或有合规要求：重新加密/mTLS；
- 海量证书集中治理：边缘终止更易运维，但扩大网关敏感性；
- 需要工作负载身份：服务网格或内部 mTLS；
- 性能敏感：测量连接复用、握手 CPU 和网关容量，不要直接取消上游验证。

## 9. 练习与答案

**问题：** TLS 透传时能否按 `/api/v1` 和 `/api/v2` 路由？

通常不能，因为 HTTP Path 在加密应用数据里。除非先终止 TLS，或由后端完成该路由。

**问题：** 网关到后端使用 HTTPS，是否就是客户端到后端端到端 TLS？

不是一条 TLS 会话，而是两条独立会话。网关能访问中间明文。

## 10. 参考资料

- [Kubernetes Gateway API TLS](https://gateway-api.sigs.k8s.io/guides/tls/)
- [Envoy TLS Architecture](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/security/ssl)
