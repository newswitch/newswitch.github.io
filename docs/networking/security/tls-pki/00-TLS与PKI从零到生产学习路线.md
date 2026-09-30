---
title: "TLS 与 PKI 从零到生产学习路线"
sidebar_label: "00. TLS 与 PKI 学习路线"
sidebar_position: 0
description: "从密码学原语、TLS 1.3 握手和 X.509 信任链，进入证书文件、mTLS、自动轮换、Kubernetes、性能分析和生产排障。"
tags: [TLS, TLS 1.3, PKI, X.509, HTTPS, mTLS]
---

# TLS 与 PKI 从零到生产学习路线

TLS 不是“给网站放一张证书”，而是一套在不可信网络上协商算法、验证身份、派生密钥并保护后续数据的协议。PKI 也不只是 CA 签字，它还包括身份命名、证书链、信任锚、用途约束、吊销、私钥保护和生命周期管理。

本路线以 TLS 1.3 为主线，以 TLS 1.2 为兼容对照。SSL、TLS 1.0 和 TLS 1.1 只用于理解历史，不作为新系统配置目标。

## 1. 一次 HTTPS 请求的总路径

```text
URL
  → DNS 得到服务地址
  → TCP 三次握手（HTTP/1.1、HTTP/2）
  → TLS ClientHello / ServerHello
  → ECDHE 计算共享秘密
  → 服务端证书与签名证明身份
  → 客户端验证域名、证书链、用途和时间
  → HKDF 派生双向流量密钥
  → AEAD 保护 HTTP 数据
  → 连接关闭或会话恢复信息留存
```

HTTP/3 使用 QUIC 承载 HTTP，TLS 1.3 握手被集成进 QUIC，而不是先建立一个普通 TCP 连接。两条路径将在协议边界文章中分别说明。

## 2. 推荐阅读顺序

| 阶段 | 文章 | 读完需要回答的问题 |
| --- | --- | --- |
| 原理 | [TLS 解决什么问题与安全边界](./01-TLS解决什么问题与安全边界.md) | TLS 防住什么，端点失陷后为什么仍可能泄露 |
| 原理 | [对称加密、非对称加密、签名、哈希、HMAC 与 AEAD](./02-对称加密非对称加密签名哈希HMAC与AEAD.md) | 认证、密钥协商和数据加密为什么使用不同原语 |
| 原理 | [TLS Record 记录层、状态机与报文结构](./03-TLS-Record记录层状态机与报文结构.md) | Handshake、Alert 和 Application Data 怎样承载 |
| 原理 | [TLS 1.3 完整握手与密钥派生](./04-TLS13完整握手与密钥派生.md) | 每条消息负责什么，密钥从哪里来 |
| 兼容 | [TLS 1.2 与 TLS 1.3 的差异](./05-TLS12与TLS13握手密码套件及兼容性差异.md) | Cipher Suite 语义和握手轮次怎样变化 |
| 高级 | [Session Resumption、PSK、Session Ticket 与 0-RTT](./06-Session-Resumption-PSK-Session-Ticket与0RTT.md) | 恢复怎样提速，0-RTT 为什么可能重放 |
| PKI | [X.509 证书字段、SAN、Key Usage 与 EKU](./07-X509证书字段SAN-KeyUsage-EKU与证书身份.md) | 证书声明了什么，CN 为什么不能代替 SAN |
| PKI | [根 CA、中间 CA、证书链与路径验证](./08-根CA中间CA证书链信任库与路径验证.md) | 服务端发什么，客户端信任什么 |
| 文件 | [PEM、DER、CRT、KEY、CSR、P12、PFX 与 JKS](./09-PEM-DER-CRT-KEY-CSR-P12-PFX与JKS文件详解.md) | 每个文件保存什么、是否保密、如何转换 |
| 实验 | [使用 OpenSSL 建立 CA、签发、验证与吊销证书](./10-使用OpenSSL建立CA签发验证与吊销证书.md) | 怎样亲手构造完整信任链并验证失败场景 |
| 架构 | [TLS 终止、透传、重新加密与端到端边界](./11-TLS终止透传重新加密与端到端加密架构.md) | 私钥放在哪里，哪一段是明文 |
| 协议 | [SNI、ALPN、HTTPS、HTTP/2、HTTP/3 与 QUIC](./12-SNI-ALPN-HTTPS-HTTP2-HTTP3与QUIC的关系.md) | 同一 IP 怎样选择证书与应用协议 |
| 身份 | [mTLS、客户端证书、服务身份与 SPIFFE](./13-mTLS客户端证书服务身份与SPIFFE.md) | 传输身份怎样映射为授权主体 |
| 自动化 | [ACME、cert-manager 与 Vault PKI 证书自动化](./14-ACME-cert-manager与Vault-PKI证书自动化.md) | 如何申请、续期、分发和轮换证书 |
| 云原生 | [Kubernetes Secret、Ingress、Gateway 与证书轮换](./15-Kubernetes-Secret-Ingress-Gateway与证书轮换.md) | 集群内证书对象怎样到达真实进程 |
| 观测 | [使用 OpenSSL、Curl、Tcpdump 与 Wireshark 分析 TLS](./16-openssl-curl-tcpdump与Wireshark分析TLS.md) | 如何把“握手失败”转化为报文证据 |
| 性能 | [TLS 握手性能、会话复用、容量规划与加速](./17-TLS握手性能会话复用容量规划与加速.md) | CPU、RTT、证书链和连接复用怎样影响延迟 |
| 排障 | [TLS 证书与握手故障排查 Runbook](./18-TLS证书与握手故障排查Runbook.md) | 如何按 TCP、协商、证书、mTLS、HTTP 分层定位 |
| 源码 | [OpenSSL 组件、状态机、BIO、EVP 与一次握手调用链](./19-OpenSSL组件状态机BIO-EVP与一次握手调用链.md) | 配置最终怎样进入密码算法和 Socket I/O |

## 3. 文件关系总图

```text
server.key ──提取公钥──┐
                       ├─ server.csr ──CA 签名── server.crt
主体/SAN/用途声明 ─────┘                         │
                                               ├─ fullchain.pem
intermediate-ca.crt ───────────────────────────┘

客户端本地 trust store：root-ca.crt（以及系统公共根）
服务端通常发送：server.crt + intermediate-ca.crt
服务端绝不能发送：server.key、任何 CA 私钥
```

文件扩展名不是安全语义。`.pem` 描述文本编码边界，`.crt` 和 `.cer` 多为命名习惯；判断内容应使用 `openssl x509`、`openssl pkey`、`openssl req` 和 `file`，不能只看后缀。

## 4. 能力分级

```text
Level 1：能解释 TLS 提供的机密性、完整性和身份认证
Level 2：能逐条解释 TLS 1.3 完整握手
Level 3：能读懂 X.509 字段和构造正确证书链
Level 4：能部署 HTTPS、mTLS、透传和重新加密
Level 5：能自动签发、轮换、监控并安全保管私钥
Level 6：能抓包、量化性能并从源码定位握手故障
```

“浏览器显示小锁”只说明当前连接通过了浏览器的校验策略，不代表应用没有鉴权漏洞、终端没有恶意软件、后端明文链路一定安全，或证书私钥从未泄露。

## 5. 实验边界

本系列的私有 CA 实验仅用于学习或受控内部环境。公网服务应使用受客户端信任的 CA；生产内部 PKI 也应实施离线根 CA、受控中间 CA、最小权限签发、审计、短生命周期证书和恢复演练。

## 6. 规范入口

- [RFC 8446：TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446)
- [RFC 5246：TLS 1.2](https://www.rfc-editor.org/rfc/rfc5246)
- [RFC 5280：X.509 PKI Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280)
- [RFC 8996：Deprecating TLS 1.0 and TLS 1.1](https://www.rfc-editor.org/rfc/rfc8996)
- [OpenSSL Documentation](https://docs.openssl.org/)
