---
title: "对称加密、非对称加密、签名、哈希、HMAC 与 AEAD"
sidebar_label: "02. TLS 密码学基础"
sidebar_position: 2
description: "从 TLS 真实使用方式理解随机数、哈希、密钥交换、数字签名、HKDF 和 AEAD 的分工。"
tags: [TLS, 密码学, AEAD, ECDHE, HKDF, 数字签名]
---

# 对称加密、非对称加密、签名、哈希、HMAC 与 AEAD

TLS 不是选择一种“最强加密算法”解决所有问题。不同原语分别承担密钥协商、身份签名、密钥派生和数据保护，混淆它们会导致错误配置和错误排障。

## 1. TLS 所需的密码学积木

```text
安全随机数 ──────────────> 临时私钥、Nonce、Ticket
(EC)DHE ────────────────> 共享秘密
证书私钥 + 数字签名 ─────> 身份与握手绑定
Transcript Hash ────────> 绑定完整握手历史
HKDF ───────────────────> 派生多个方向、阶段的密钥
AEAD ───────────────────> 加密并校验应用数据
```

## 2. 哈希函数

哈希函数把任意长度输入映射为固定长度摘要：

```text
digest = SHA-256(message)
```

目标包括难以从摘要恢复原文、难以找到相同摘要的不同输入，以及输入微小变化导致摘要显著变化。哈希没有秘密密钥，因此不能单独证明消息来自谁。

TLS 使用 Transcript Hash 累积握手消息。`Finished` 和 `CertificateVerify` 都与握手历史绑定，攻击者不能静默删除或替换前面的协商内容。

## 3. HMAC 与 HKDF

HMAC 在哈希基础上加入秘密密钥，可用于验证持有相同密钥的一方生成的数据。HKDF 使用 HMAC 完成 Extract 和 Expand：

```text
输入秘密 + Salt
  → HKDF-Extract
  → Pseudorandom Key
  → HKDF-Expand + Label + Context
  → 握手密钥、应用密钥、Finished Key、Exporter Secret
```

TLS 1.3 不把一个共享秘密直接当作所有用途的密钥，而是通过标签和上下文派生相互隔离的秘密。客户端写密钥与服务端写密钥也不同。

## 4. 对称加密与 AEAD

对称算法使用同一秘密材料保护和恢复数据，速度快，适合持续传输。现代 TLS 使用 AEAD，例如：

- AES-128-GCM；
- AES-256-GCM；
- ChaCha20-Poly1305。

AEAD 接收：

```text
Key + Nonce + Plaintext + Additional Authenticated Data
  → Ciphertext + Authentication Tag
```

附加认证数据不会被加密，但被完整性保护。若密文、Nonce、附加数据或 Tag 不匹配，解密失败。

### 4.1 Nonce 为什么不能乱复用

同一密钥下重复使用某些 AEAD Nonce 会严重破坏安全性。TLS 根据流量秘密、静态 IV 和记录序号构造每条记录的 Nonce，应用不应自行修改这一机制。

## 5. 非对称密码与数字签名

非对称体系有公钥和私钥。数字签名过程可抽象为：

```text
签名：signature = Sign(private_key, message)
验证：Verify(public_key, message, signature)
```

任何人可以获得证书中的公钥，但只有私钥持有者能生成有效签名。TLS 1.3 的服务端使用证书私钥签署握手上下文，而不是用私钥解密客户端传来的全部业务数据。

常见签名密钥包括 RSA、ECDSA 和 EdDSA。证书公钥算法、证书签名算法与握手选择的签名方案是相关但不同的概念。

## 6. (EC)DHE 密钥交换

Diffie-Hellman 类算法允许双方在公开交换临时公钥后独立计算相同共享秘密：

```text
Client ephemeral private + Server ephemeral public
                         ↓
                   Shared Secret
                         ↑
Server ephemeral private + Client ephemeral public
```

共享秘密本身不直接在网络上传输。TLS 1.3 常见组包括 X25519 和不同 NIST 曲线，具体支持由实现与策略决定。

纯 DH 交换不能单独防止中间人，因此服务端还要用证书私钥签名握手上下文，将临时 Key Share 与已认证身份绑定。

## 7. Cipher Suite 到底表示什么

TLS 1.3 套件示例：

```text
TLS_AES_128_GCM_SHA256
```

它表达记录保护的 AEAD 和 HKDF 使用的哈希，不再把证书类型与密钥交换都编码进名字。Key Exchange Group 和 Signature Scheme 通过独立扩展协商。

TLS 1.2 套件示例：

```text
TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
```

名称同时包含密钥交换、认证、对称加密和哈希，语义与 TLS 1.3 不同。不能拿一份 TLS 1.2 Cipher 列表直接解释 TLS 1.3。

## 8. RSA 的三个不同角色

“使用 RSA”可能指：

1. CA 用 RSA 私钥给证书签名；
2. 服务端证书公钥是 RSA，握手中用 RSA-PSS 等方案签名；
3. 旧 TLS 使用 RSA Key Exchange，让客户端加密 Premaster Secret。

前两者仍可能出现在现代部署；第三种不具备前向保密，也不属于 TLS 1.3。

## 9. 随机数与私钥保护

强算法无法弥补弱随机数。密钥生成需要操作系统 CSPRNG；不要使用普通伪随机函数、时间戳或可预测种子生成私钥和 Token。

私钥的控制措施包括：

- 文件最小权限和独立运行身份；
- 加密存储及受控解密流程；
- HSM/KMS 或不可导出密钥接口；
- 禁止写入镜像、Git、日志和备份明文；
- 轮换、吊销、审计与泄露响应。

## 10. 练习与答案

**问题 1：** 为什么 TLS 不用 RSA 公钥持续加密全部 HTTP 数据？

非对称运算开销大且长度受限，不适合数据流；现代 TLS 用 (EC)DHE 协商秘密，再使用高效对称 AEAD 保护记录。

**问题 2：** SHA-256 文件摘要能否证明文件由供应商发布？

摘要只能检测与给定摘要是否一致。若摘要和文件都来自同一被攻击渠道，攻击者可以同时替换两者；还需要签名或另一可信渠道。

**问题 3：** ECDHE 已生成共享秘密，为什么仍需要证书签名？

未经认证的 ECDHE 可能遭受中间人分别与两端协商。证书签名把临时密钥交换绑定到经过 PKI 验证的身份。

## 11. 参考资料

- [RFC 8446：TLS 1.3 Cryptographic Computations](https://www.rfc-editor.org/rfc/rfc8446)
- [RFC 5869：HKDF](https://www.rfc-editor.org/rfc/rfc5869)
- [RFC 5116：AEAD Interface](https://www.rfc-editor.org/rfc/rfc5116)
