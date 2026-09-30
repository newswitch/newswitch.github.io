---
title: "TLS 握手性能、会话复用、容量规划与加速"
sidebar_label: "17. TLS 性能与容量规划"
sidebar_position: 17
description: "量化 TLS 的网络往返、非对称计算、证书链、连接复用、会话恢复和网关容量。"
tags: [TLS 性能, 容量规划, Session Resumption, 握手延迟]
---

# TLS 握手性能、会话复用、容量规划与加速

TLS 性能不能只看“每秒能做多少次 RSA”。真实延迟由 DNS、TCP/QUIC、网络 RTT、丢包、握手算法、证书链、会话命中、代理层数和应用处理共同组成。

## 1. 延迟模型

对新建 TLS-over-TCP 连接，可用近似模型：

```text
T_total ≈ T_DNS + T_TCP + T_TLS + T_HTTP_queue + T_backend
```

TLS 1.3 无重试完整握手通常在 TCP 建连后约一个网络往返进入应用数据；HelloRetryRequest、丢包、OCSP/链获取和多层代理会增加时间。

## 2. 为什么连接复用优先级高

新连接消耗：

- TCP/QUIC 状态；
- TLS 握手 CPU；
- 证书链字节；
- 内存、Socket、Conntrack 和 NAT 表项；
- 网关到后端的另一次建连。

HTTP Keep-Alive、HTTP/2 多路复用和健康的连接池能直接避免大部分重复握手。恢复只能降低新握手成本，不能消除连接风暴。

## 3. 证书和算法开销

需要测量而非绝对化判断：

- RSA/ECDSA/EdDSA 的签名与验证成本不同；
- 密钥长度、曲线、硬件和密码库实现影响很大；
- 长证书链增加字节、解析和验证工作；
- 客户端验证通常也消耗 CPU；
- AES-NI/ARM Crypto Extension 会改变 AES-GCM 与 ChaCha20-Poly1305 的相对表现。

选算法必须同时满足客户端兼容、安全策略和真实硬件性能。

## 4. 容量模型

设：

- `C_new`：每秒新连接数；
- `H_full`：完整握手比例；
- `CPU_full`：单次完整握手平均 CPU 时间；
- `CPU_resume`：恢复握手平均 CPU 时间；
- `U_target`：允许用于 TLS 的 CPU 核利用率。

近似 CPU 核需求：

```text
Cores ≈ C_new × [H_full × CPU_full
                + (1-H_full) × CPU_resume] / U_target
```

单位必须统一，例如 CPU 时间使用秒。再加入突发系数、故障转移容量、证书轮换和多租户隔离余量。

示例：

```text
20,000 新连接/s
完整握手 30%，每次 0.8 ms CPU
恢复握手 70%，每次 0.2 ms CPU
目标利用率 60%

CPU/s = 20000 × (0.3×0.0008 + 0.7×0.0002) = 7.6 core-seconds/s
Cores  ≈ 7.6 / 0.6 = 12.7
```

该数字只是模型输入示例，不能替代在目标 CPU、证书和软件版本上的压测。

## 5. 多层 TLS

```text
Client → CDN → LB → Gateway → Sidecar → Backend
```

一次用户请求可能触发多条连接。外部 Keep-Alive 很好，但 Gateway 到 Backend 没有连接池，仍会在内部形成握手风暴。必须分别观察每一跳的新连接率和恢复命中率。

## 6. 性能优化顺序

1. 减少不必要的新连接，修复连接池和超时；
2. 启用并观测 Session Resumption；
3. 使负载均衡节点正确共享/轮换会话状态；
4. 缩短不必要的证书链，启用合理 OCSP Stapling；
5. 选择适合硬件与客户端的算法；
6. 调整 Worker、CPU 亲和性和 Accept 队列；
7. 在明确安全边界后评估硬件卸载；
8. 谨慎评估 0-RTT 的业务重放风险。

## 7. 压测设计

分别测试：

| 场景 | 目的 |
| --- | --- |
| 单连接多请求 | 应用与记录层吞吐 |
| 大量完整握手 | 最坏新连接 CPU |
| 恢复握手 | Session 命中收益 |
| 不同 RTT/丢包 | 网络敏感性 |
| 不同证书链/算法 | 密码与解析开销 |
| 多层代理 | 内部连接放大 |
| 单节点故障 | 剩余节点容量与 Ticket 命中 |

记录 TLS 版本、Cipher、Key Group、证书、客户端工具和连接复用设置，否则结果不可复现。

## 8. 关键指标

- 新建连接/s、并发连接、连接寿命；
- 完整/恢复握手/s 与成功率；
- Handshake Latency P50/P95/P99；
- TLS Worker CPU、Run Queue、上下文切换；
- Session Cache/Ticket 命中率；
- Alert、版本、Cipher、SNI 和证书错误；
- 网络重传、SYN 队列、Accept 队列和 Conntrack；
- 上游连接池命中及重建速率。

## 9. 练习与答案

**问题：** TLS CPU 很高，直接开启 0-RTT 是否是首选？

不是。先判断是否存在连接未复用、恢复未命中或内部连接风暴。0-RTT 带来重放语义，不能用来掩盖连接管理问题。

**问题：** 为什么故障切换后握手 CPU 突然升高？

剩余节点同时承接新连接，且原节点签发的 Ticket 可能无法恢复，导致完整握手比例和新连接突发同时上升。

## 10. 参考资料

- [RFC 8446：TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446)
- [OpenSSL speed](https://docs.openssl.org/master/man1/openssl-speed/)
