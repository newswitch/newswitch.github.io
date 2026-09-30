---
title: "Session Resumption、PSK、Session Ticket 与 0-RTT"
sidebar_label: "06. 会话恢复、PSK 与 0-RTT"
sidebar_position: 6
description: "理解 TLS 1.3 会话恢复、NewSessionTicket、PSK Binder、0-RTT 重放风险和集群 Ticket Key 管理。"
tags: [TLS 1.3, Session Resumption, PSK, 0-RTT, Session Ticket]
---

# Session Resumption、PSK、Session Ticket 与 0-RTT

会话恢复的目标是复用先前连接建立的信任和秘密，降低新连接的计算与网络开销。它不是复用原 TCP 连接，也不是跳过所有安全验证。

## 1. 三种容易混淆的复用

| 机制 | 复用对象 | 是否新建连接 |
| --- | --- | --- |
| HTTP Keep-Alive/HTTP2 多路复用 | 已建立的 TLS 连接 | 否 |
| TLS Session Resumption | 先前 TLS 会话状态 | 是 |
| 连接池 | 应用保存的一组现有连接 | 视池状态而定 |

减少握手最有效的办法通常是先避免不必要的新连接，再考虑恢复命中率。

## 2. TLS 1.3 NewSessionTicket

完整握手后，服务端可发送一条或多条 NewSessionTicket。客户端保存：

- Ticket/PSK Identity；
- 由 Resumption Master Secret 派生的 PSK；
- Ticket Lifetime；
- Age Add、Nonce；
- 是否允许 Early Data 及其大小。

后续 ClientHello 带上 PSK Identity 与 Binder。Binder 基于当前 ClientHello 的 Transcript 计算，证明客户端确实掌握 PSK，而不是只复制一个 Ticket 字节串。

## 3. 服务端有状态与无状态 Ticket

有状态方案保存 Session ID 到会话数据的映射；无状态 Ticket 把状态加密认证后交给客户端保存。后者减轻服务端逐会话存储，但需要安全管理 Ticket Encryption Key。

集群中若节点 Ticket Key 不一致：

```text
请求落到签发节点 → 恢复成功
请求落到其他节点 → 无法解开 Ticket → 完整握手
```

这通常表现为恢复命中率波动，而不是业务必然失败。共享 Ticket Key 会扩大密钥泄露影响面，因此需要版本化、轮换、新旧重叠和访问控制，不能长期静态复制一个文件。

## 4. PSK + (EC)DHE

恢复时可以仅使用 PSK，也可同时进行新的 (EC)DHE。后者增加一次新的临时密钥贡献，通常具有更好的前向保密性质。具体模式由 `psk_key_exchange_modes` 与服务端策略决定。

## 5. 0-RTT Early Data

持有有效 PSK 的客户端可把 Early Data 与第一个 ClientHello 一起发送：

```text
ClientHello + early application data  → Server
```

这样应用数据无需等待服务端握手响应，但 Early Data 存在重要边界：

- 可能被网络攻击者重放；
- 不具备与当前新握手相同的全部前向保密属性；
- 服务端可能拒绝，客户端要安全重试；
- 多节点防重放需要共享或分区状态，复杂度高。

适合 0-RTT 的操作应具备幂等、可去重和重放可接受性。转账、创建订单、修改权限等有副作用请求不应仅靠 HTTP 方法名称判断安全。

## 6. 恢复不等于跳过身份风险

恢复基于先前会话建立的身份。如果服务端证书已经轮换或原私钥泄露，旧 Ticket 是否继续有效取决于 Ticket 生命周期与服务端密钥策略。重大密钥事件发生后，往往需要同时轮换或失效相关 Ticket Key。

## 7. 观察恢复

OpenSSL 可保存和重用会话：

```bash
openssl s_client -connect example.com:443 \
  -servername example.com \
  -sess_out session.pem </dev/null

openssl s_client -connect example.com:443 \
  -servername example.com \
  -sess_in session.pem </dev/null
```

不同 OpenSSL 版本的输出字段有差异，应查看 `New`/`Reused`、协议、套件以及 Session/Ticket 信息。TLS 1.3 Ticket 可能在握手完成后异步到达，过早关闭 stdin 会导致没有保存到 Ticket。

## 8. 监控指标

- 完整握手与恢复握手数量；
- Session Cache 命中、未命中、超时和淘汰；
- Ticket 解密失败率；
- 0-RTT 接受、拒绝和重放防护结果；
- 握手 CPU 时间与延迟分位数；
- 不同负载均衡节点的恢复命中差异。

## 9. 练习与答案

**问题：** Session Ticket 泄露是否等同于服务器证书私钥泄露？

不是同一种秘密，但都可能影响会话安全。Ticket 本身与客户端保存的 PSK、服务端 Ticket Key 的风险不同；服务端 Ticket Key 泄露可能影响一批尚在有效期内的恢复会话。

**问题：** 开启 0-RTT 是否一定降低用户 TTFT？

不一定。连接复用、DNS、网络 RTT、网关排队和后端处理都可能主导延迟；服务端拒绝 Early Data 还会触发重试。必须按真实请求链测量。

## 10. 参考资料

- [RFC 8446 Sections 2.2 and 4.6.1](https://www.rfc-editor.org/rfc/rfc8446)
- [RFC 8470：Using Early Data in HTTP](https://www.rfc-editor.org/rfc/rfc8470)
