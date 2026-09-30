---
title: "PEM、DER、CRT、KEY、CSR、P12、PFX 与 JKS 文件详解"
sidebar_label: "09. TLS 文件与格式"
sidebar_position: 9
description: "系统区分证书、私钥、CSR、证书链、Truststore 与 Keystore 的内容、编码、保密级别和转换方法。"
tags: [PEM, DER, CRT, CSR, PKCS12, JKS, 私钥]
---

# PEM、DER、CRT、KEY、CSR、P12、PFX 与 JKS 文件详解

扩展名只是线索，不是可靠类型系统。排障时先识别“对象是什么”，再识别“怎样编码、是否加密、谁需要它”。

![TLS 文件、编码和容器关系](/img/networking/tls-pki/tls-files.svg)

## 1. 三个维度

```text
对象：私钥 / 公钥 / CSR / 证书 / CRL / 多对象容器
编码：DER（二进制）/ PEM（Base64 + BEGIN/END）
容器：PKCS#12 / JKS / PEM Bundle
```

`.crt` 可能是 PEM，也可能是 DER；`.pem` 里可能是证书、私钥、CSR 或多个对象。

## 2. PEM 与 DER

PEM 示例：

```text
-----BEGIN CERTIFICATE-----
MIID...
-----END CERTIFICATE-----
```

DER 是 ASN.1 对象的二进制编码，没有 BEGIN/END 文本边界。转换：

```bash
openssl x509 -in server.pem -outform DER -out server.der
openssl x509 -in server.der -inform DER -out server.pem
```

## 3. 常见对象

| 文件 | 典型内容 | 保密要求 |
| --- | --- | --- |
| `server.key` | PKCS#8/传统格式私钥 | 最高 |
| `server.pub` | 公钥 | 可公开 |
| `server.csr` | 公钥、申请字段、申请者签名 | 通常可公开 |
| `server.crt` | CA 签发的叶子证书 | 可公开但可能含资产信息 |
| `intermediate.crt` | 中间 CA 证书 | 可公开 |
| `fullchain.pem` | 叶子证书 + 中间证书 | 可公开 |
| `ca-bundle.crt` | 一组受信任 CA 证书 | 可公开，分发必须可信 |
| `crl.pem` | 已撤销证书序列等信息 | 可公开 |

## 4. 私钥格式

生成加密 PKCS#8 私钥：

```bash
openssl genpkey -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -aes-256-cbc -out server.key
```

查看而不输出私钥材料：

```bash
openssl pkey -in server.key -noout -text_pub
openssl pkey -in server.key -pubout -out server.pub
```

不要用 `openssl rsa -text` 的完整输出粘贴到工单或日志，其中可能包含敏感私钥参数。

## 5. CSR

```bash
openssl req -in server.csr -noout -text -verify
```

CSR 不是证书，不能直接配置为 `ssl_certificate`。它由申请者私钥签名，只证明申请者当时持有对应私钥；CA 仍要审核身份与扩展。

## 6. PKCS#12、PFX、Keystore 与 Truststore

`.p12` 和 `.pfx` 通常都指 PKCS#12 容器，可包含：

- 私钥；
- 叶子证书；
- 中间证书链；
- 友好名称和属性。

导出：

```bash
openssl pkcs12 -export \
  -inkey server.key \
  -in server.crt \
  -certfile intermediate-ca.crt \
  -name api.example.com \
  -out server.p12
```

查看结构：

```bash
openssl pkcs12 -in server.p12 -info -noout
```

Java Keystore 保存本端身份私钥与证书链；Truststore 保存受信任 CA。现代 Java 常使用 PKCS#12 作为 Keystore 格式，旧系统仍可能使用 JKS。两者是“用途角色”与“容器格式”的组合，不应把所有 `.jks` 都当成同一种内容。

## 7. 检查私钥、CSR 与证书是否匹配

通用方法是分别提取公钥并比较摘要：

```bash
openssl pkey -in server.key -pubout -outform DER |
  openssl sha256

openssl req -in server.csr -pubkey -noout |
  openssl pkey -pubin -outform DER |
  openssl sha256

openssl x509 -in server.crt -pubkey -noout |
  openssl pkey -pubin -outform DER |
  openssl sha256
```

三个摘要应一致。比较 RSA Modulus 只适用于 RSA，提取公钥的方法也适用于 EC 等密钥。

## 8. Kubernetes TLS Secret

`kubernetes.io/tls` 类型约定键：

```text
tls.crt  叶子证书及所需中间链
tls.key  对应私钥
```

`ca.crt` 是许多控制器采用的附加约定，但不是该 Secret 类型要求的两个标准键之一。具体网关、Operator 或应用是否读取它必须查看产品文档。

## 9. 权限与分发

建议：

- 私钥所有者为实际服务身份，权限尽量收紧；
- 避免在命令行参数暴露密码，因为可能进入进程列表或历史；
- 避免把未加密私钥写入 Git、镜像层、ConfigMap 和日志；
- Secret 的 Base64 是编码，不是加密；
- 备份私钥时同时设计访问控制、加密、恢复验证和销毁。

## 10. 练习与答案

**问题：** `server.pem` 一定是证书吗？

不一定。应查看 BEGIN 标签并用对应 OpenSSL 子命令解析。

**问题：** Nginx 提示 private key mismatch，最可靠的检查是什么？

从私钥和叶子证书分别提取公钥，以相同 DER 编码计算摘要并比较；同时确认 `ssl_certificate` 文件第一张是正确叶子证书。

## 11. 参考资料

- [OpenSSL pkey](https://docs.openssl.org/master/man1/openssl-pkey/)
- [OpenSSL pkcs12](https://docs.openssl.org/master/man1/openssl-pkcs12/)
- [Kubernetes TLS Secrets](https://kubernetes.io/docs/concepts/configuration/secret/#tls-secrets)
