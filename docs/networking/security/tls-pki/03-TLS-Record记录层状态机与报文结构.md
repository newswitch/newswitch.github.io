---
title: "TLS Record 记录层、状态机与报文结构"
sidebar_label: "03. TLS Record 与状态机"
sidebar_position: 3
description: "理解 TLS Record 如何承载握手、告警和应用数据，以及记录序号、分片、加密边界与状态转换。"
tags: [TLS, Record Layer, Handshake, Alert, AEAD]
---

# TLS Record 记录层、状态机与报文结构

抓包时看到的 TLS Record 不是“一条 Record 就是一条 HTTP 请求”，也不保证“一条握手消息对应一个 TCP 包”。必须分清 TCP 字节流、TLS Record、Handshake Message 和应用协议四个层次。

## 1. 分层关系

```text
HTTP / HTTP2 Frame / 其他应用协议
              ↓
TLS Handshake / Alert / Application Data
              ↓
TLS Record
              ↓
TCP 字节流
              ↓
IP Packet → Ethernet Frame
```

TCP 可以拆分或合并 TLS Record；TLS 也可以把应用数据切成多条 Record。抓包工具显示的边界受 MSS、TSO/GSO、GRO/LRO 和抓包位置影响。

## 2. TLSPlaintext 结构

概念结构为：

```text
struct {
    ContentType type;          // 1 byte
    ProtocolVersion version;   // 2 bytes
    uint16 length;             // 2 bytes
    opaque fragment[length];
} TLSPlaintext;
```

常见 ContentType：

| 值 | 类型 | 作用 |
| --- | --- | --- |
| 20 | ChangeCipherSpec | TLS 1.2 状态转换；TLS 1.3 中可作为兼容消息 |
| 21 | Alert | 错误与关闭通知 |
| 22 | Handshake | ClientHello、ServerHello 等 |
| 23 | Application Data | 加密后的握手或应用数据外层常显示为该类型 |

TLS 1.3 为兼容中间设备，受保护记录的外层类型通常是 `application_data`，真实内层类型放在加密内容尾部。

## 3. 一条握手消息的结构

```text
HandshakeType msg_type;   // 1 byte
uint24 length;            // 3 bytes
body[length];
```

同一 Record 可包含多条握手消息，一条握手消息也可能跨越多条 Record。解析器必须按长度重组，而不能假定网络读取一次就得到完整消息。

## 4. 明文到密文的变化

握手开始时 ClientHello 和 ServerHello 通常可见。双方得到握手流量秘密后，后续消息被保护：

```text
TLSInnerPlaintext
  = content || inner_content_type || padding

TLSCiphertext
  = opaque_type(application_data)
  + legacy_record_version
  + length
  + AEAD(content, additional_data, nonce)
```

抓包看到许多 `Application Data` 不代表 HTTP 已经开始，其中可能包含 EncryptedExtensions、Certificate、CertificateVerify 和 Finished。

## 5. 记录序号与 Nonce

每个通信方向维护独立的记录序号：

```text
client_write_key / client_write_iv / client_sequence
server_write_key / server_write_iv / server_sequence
```

Nonce 由流量 IV 与记录序号按规范组合。序号不在 TLS 1.3 Record Header 中明文传输，而由两端状态同步维护。丢失 TCP 字节不会被悄悄跳过，因为 TCP 先负责可靠有序交付；认证失败时连接终止。

## 6. Alert

Alert 包含级别和描述。常见描述包括：

- `close_notify`：发送方不会再发送记录；
- `unexpected_message`：状态机收到不允许的消息；
- `bad_record_mac`：记录认证失败；
- `handshake_failure`：无法协商或完成握手；
- `bad_certificate`、`unknown_ca`、`certificate_expired`；
- `protocol_version`；
- `no_application_protocol`：ALPN 没有共同协议。

TLS 1.3 将许多错误视为 fatal。应用日志中的 “SSL_ERROR_SYSCALL” 或 “connection reset” 不一定包含对端真实 Alert，需要结合双端日志和抓包。

## 7. 状态机而非固定脚本

完整握手、PSK 恢复、0-RTT、客户端认证和 HelloRetryRequest 的消息序列不同。实现会维护：

```text
当前角色
协商版本
已发送/接收消息
Transcript Hash
握手/应用流量秘密
是否请求客户端证书
是否允许 Early Data
```

收到顺序正确但内容不满足当前策略的消息，也会失败。因此排障要同时检查“报文有没有到”和“状态机为什么拒绝”。

## 8. TLS 与 TCP 关闭

理想关闭过程包含 TLS `close_notify`，随后关闭 TCP。若直接收到 FIN/RST 而没有 `close_notify`，实现可能报告 `unexpected eof`。这可能是代理超时、进程退出、网络设备重置或对端没有优雅关闭，不能直接判断为证书故障。

## 9. 抓包判断方法

未提供会话密钥时，通常仍可判断：

1. TCP 是否成功；
2. ClientHello 是否发出；
3. SNI、Supported Versions、Cipher Suites、Groups、ALPN；
4. ServerHello 或明文 Alert 是否返回；
5. 加密记录出现在哪一侧；
6. 谁先发送 FIN/RST。

拥有客户端导出的 Key Log 且算法/协议受工具支持时，Wireshark 可以解密会话。服务端私钥通常不能解密现代 ECDHE 会话。

## 10. 练习与答案

**问题 1：** 为什么 Wireshark 在 ServerHello 后显示 Application Data，却还没有 HTTP 请求？

TLS 1.3 将后续握手消息加密，外层 Record 类型使用 Application Data；它可能仍是证书与 Finished。

**问题 2：** 一个 TCP 包能否携带两条 TLS Record？

可以。TCP 是字节流，分段与 TLS Record 边界相互独立。

**问题 3：** 只抓服务端网卡，为什么可能看到远大于 MTU 的“包”？

抓包位置可能位于 TSO/GSO 分段之前或 GRO/LRO 合并之后。它反映主机协议栈中的大段缓冲，不一定是线上实际帧长。

## 11. 参考资料

- [RFC 8446 Section 5：Record Protocol](https://www.rfc-editor.org/rfc/rfc8446#section-5)
- [RFC 8448：TLS 1.3 Traces](https://www.rfc-editor.org/rfc/rfc8448)
