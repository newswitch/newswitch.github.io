---
title: "X.509 证书字段、SAN、Key Usage、EKU 与证书身份"
sidebar_label: "07. X.509 证书字段与身份"
sidebar_position: 7
description: "逐字段理解 X.509 证书的主体、颁发者、SAN、Basic Constraints、Key Usage、EKU 和签名。"
tags: [X.509, SAN, Key Usage, EKU, 证书]
---

# X.509 证书字段、SAN、Key Usage、EKU 与证书身份

证书不是公钥文件换了一个后缀。它是 CA 对“公钥、身份声明、用途约束和有效期”等内容签名后的数据结构。

## 1. 查看证书

```bash
openssl x509 -in server.crt -noout -text
```

重点字段：

```text
Version / Serial Number
Signature Algorithm
Issuer
Validity: Not Before / Not After
Subject
Subject Public Key Info
X509v3 Basic Constraints
X509v3 Key Usage
X509v3 Extended Key Usage
X509v3 Subject Alternative Name
Authority Key Identifier / Subject Key Identifier
Certificate Signature
```

## 2. Subject 与 Issuer

- Subject：证书描述的主体；
- Issuer：签发该证书的 CA 名称。

名称相同不能证明自签名或同一证书，必须验证签名和密钥标识。现代 HTTPS 主机名验证依赖 SAN，不应只依赖 Subject CN。

## 3. Subject Alternative Name

SAN 可以包含：

```text
DNS:api.example.com
DNS:*.example.com
IP Address:192.0.2.10
URI:spiffe://example.org/ns/prod/sa/api
```

客户端用域名访问时匹配 DNS SAN；直接以 IP 访问时通常需要匹配 IP SAN。把字符串 IP 放进 DNS SAN 不能等价替代 IP SAN。

通配符 `*.example.com` 一般只匹配一个标签，例如 `api.example.com`，不匹配 `a.b.example.com`，也不等于根域 `example.com`。

## 4. Validity

`Not Before` 和 `Not After` 定义证书允许使用的时间窗口。验证依赖客户端本地时钟，因此时间漂移可能造成：

```text
certificate is not yet valid
certificate has expired
```

证书到期监控要看所有真实入口，不只扫描证书文件；负载均衡器可能仍在提供旧证书。

## 5. Basic Constraints

CA 证书应包含：

```text
CA:TRUE
pathlen:0   # 可选，限制下面还能有几层 CA
```

叶子证书应为 `CA:FALSE` 或不具备 CA 能力。仅凭 Subject 名称包含“CA”不能成为 CA。

## 6. Key Usage 与 Extended Key Usage

Key Usage 约束密钥的密码学用途，例如：

- `digitalSignature`；
- `keyEncipherment`；
- `keyCertSign`；
- `cRLSign`。

EKU 约束应用用途，例如：

- `serverAuth`；
- `clientAuth`；
- `codeSigning`；
- `OCSPSigning`。

一张只有 `clientAuth` 的证书不应被当作 HTTPS 服务端证书。不同实现对缺失 EKU、Any EKU 和组合用途的策略可能不同，内部 PKI 应明确模板。

## 7. 公钥与签名算法

证书中至少要区分：

1. Subject Public Key Algorithm：叶子公钥类型；
2. Certificate Signature Algorithm：颁发者给证书签名的算法；
3. TLS CertificateVerify Signature Scheme：连接中证明私钥持有的算法。

它们可能相关，但不是一个字段。

## 8. Serial Number 与吊销

Serial Number 在颁发者范围内标识证书，用于 CRL、OCSP 和审计。PKI 系统应保证合理唯一性并能从业务身份追踪到签发记录。

吊销不是“删除服务端文件”。客户端必须能够获得并执行 CRL/OCSP/短证书策略，网络失败时还涉及 Fail-Open 与 Fail-Closed 选择。公网浏览器和内部服务的吊销行为可能不同，不能假定一张已撤销证书会立即被所有客户端拒绝。

## 9. CSR 与证书的边界

CSR 包含公钥、主体和请求扩展，并由申请者私钥签名以证明持有私钥。CA 必须按策略审核并重建允许的扩展，不能盲目信任申请者在 CSR 中要求 `CA:TRUE` 或任意 SAN。

## 10. 常用检查命令

```bash
openssl x509 -in server.crt -noout -subject -issuer -serial
openssl x509 -in server.crt -noout -dates
openssl x509 -in server.crt -noout -ext subjectAltName
openssl x509 -in server.crt -noout -ext keyUsage
openssl x509 -in server.crt -noout -ext extendedKeyUsage
openssl x509 -in server.crt -noout -fingerprint -sha256
```

## 11. 练习与答案

**问题：** 证书 CN 是 `api.example.com`，SAN 只有 `www.example.com`，访问前者能否通过现代主机名验证？

通常不能。存在 SAN 时主机名验证使用相应 SAN，不能用 CN 覆盖错误 SAN。

**问题：** 证书文件可以公开，是否意味着其中所有内容都无敏感性？

证书不是私钥，但 Subject、SAN、组织结构和内部域名可能暴露资产信息，应按信息分类管理；公钥本身无需保密。

## 12. 参考资料

- [RFC 5280：Internet X.509 PKI Profile](https://www.rfc-editor.org/rfc/rfc5280)
- [RFC 6125：Service Identity](https://www.rfc-editor.org/rfc/rfc6125)
