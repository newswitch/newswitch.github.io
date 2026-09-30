---
title: "使用 OpenSSL 建立 CA、签发、验证与吊销证书"
sidebar_label: "10. OpenSSL PKI 实验"
sidebar_position: 10
description: "通过根 CA、中间 CA、服务端证书和客户端证书实验，掌握 CSR、签发、链验证、mTLS 与 CRL。"
tags: [OpenSSL, CA, CSR, CRL, PKI, 实验]
---

# 使用 OpenSSL 建立 CA、签发、验证与吊销证书

本实验在临时目录构造两级 CA。它用于理解 PKI 对象，不是生产 CA 部署模板。生产根 CA 应离线，签发策略、审计、备份、HSM 和权限需要独立设计。

## 1. 目录与前提

```bash
mkdir -p tls-lab/{root,intermediate,leaf}
cd tls-lab
umask 077
openssl version -a
```

所有示例域名使用保留域 `example.com`，地址 `192.0.2.10` 属于文档地址段。

## 2. 创建根 CA

生成加密私钥：

```bash
openssl genpkey -algorithm RSA \
  -pkeyopt rsa_keygen_bits:4096 \
  -aes-256-cbc -out root/root-ca.key
```

创建自签名根证书：

```bash
openssl req -new -x509 -sha256 -days 3650 \
  -key root/root-ca.key \
  -subj '/C=CN/O=TLS Lab/CN=TLS Lab Root CA' \
  -addext 'basicConstraints=critical,CA:TRUE,pathlen:1' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -addext 'subjectKeyIdentifier=hash' \
  -out root/root-ca.crt
```

验证：

```bash
openssl x509 -in root/root-ca.crt -noout \
  -subject -issuer -dates -ext basicConstraints -ext keyUsage
```

根证书的 Subject 和 Issuer 相同，但仍应验证它确实自签名：

```bash
openssl verify -CAfile root/root-ca.crt root/root-ca.crt
```

预期：

```text
root/root-ca.crt: OK
```

## 3. 创建中间 CA

```bash
openssl genpkey -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -aes-256-cbc -out intermediate/intermediate-ca.key

openssl req -new -sha256 \
  -key intermediate/intermediate-ca.key \
  -subj '/C=CN/O=TLS Lab/CN=TLS Lab Issuing CA' \
  -out intermediate/intermediate-ca.csr
```

扩展文件：

```ini title="intermediate/intermediate.ext"
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
```

签发：

```bash
openssl x509 -req -sha256 -days 1825 \
  -in intermediate/intermediate-ca.csr \
  -CA root/root-ca.crt -CAkey root/root-ca.key \
  -CAcreateserial \
  -extfile intermediate/intermediate.ext \
  -out intermediate/intermediate-ca.crt
```

验证中间 CA：

```bash
openssl verify -CAfile root/root-ca.crt \
  intermediate/intermediate-ca.crt
```

## 4. 创建服务端证书

```bash
openssl genpkey -algorithm EC \
  -pkeyopt ec_paramgen_curve:P-256 \
  -out leaf/api.example.com.key

openssl req -new -sha256 \
  -key leaf/api.example.com.key \
  -subj '/C=CN/O=TLS Lab/CN=api.example.com' \
  -out leaf/api.example.com.csr
```

叶子扩展：

```ini title="leaf/server.ext"
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:api.example.com,DNS:api.internal.example.com,IP:192.0.2.10
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
```

签发：

```bash
openssl x509 -req -sha256 -days 90 \
  -in leaf/api.example.com.csr \
  -CA intermediate/intermediate-ca.crt \
  -CAkey intermediate/intermediate-ca.key \
  -CAcreateserial \
  -extfile leaf/server.ext \
  -out leaf/api.example.com.crt
```

构造服务端链：

```bash
cat leaf/api.example.com.crt \
  intermediate/intermediate-ca.crt \
  > leaf/api.example.com.fullchain.pem
```

根证书不需要拼进服务端 Full Chain。

## 5. 验证证书链和身份

```bash
openssl verify \
  -CAfile root/root-ca.crt \
  -untrusted intermediate/intermediate-ca.crt \
  -purpose sslserver \
  -verify_hostname api.example.com \
  leaf/api.example.com.crt
```

预期：

```text
leaf/api.example.com.crt: OK
```

故意使用错误名称：

```bash
openssl verify \
  -CAfile root/root-ca.crt \
  -untrusted intermediate/intermediate-ca.crt \
  -verify_hostname wrong.example.com \
  leaf/api.example.com.crt
```

预期包含 Hostname mismatch，而不是笼统认为“证书链坏了”。

## 6. 启动临时 TLS 服务

```bash
openssl s_server \
  -accept 8443 \
  -cert leaf/api.example.com.crt \
  -cert_chain intermediate/intermediate-ca.crt \
  -key leaf/api.example.com.key \
  -www
```

另一个终端：

```bash
openssl s_client \
  -connect 127.0.0.1:8443 \
  -servername api.example.com \
  -CAfile root/root-ca.crt \
  -verify_hostname api.example.com \
  -verify_return_error </dev/null
```

检查协议、Cipher、Peer Certificate 和 `Verify return code: 0 (ok)`。

## 7. 创建客户端证书并验证 mTLS

客户端扩展应使用 `clientAuth`：

```ini title="leaf/client.ext"
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
subjectAltName=URI:spiffe://example.org/ns/prod/sa/caller
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
```

```bash
openssl genpkey -algorithm EC \
  -pkeyopt ec_paramgen_curve:P-256 \
  -out leaf/client.key

openssl req -new -sha256 -key leaf/client.key \
  -subj '/O=TLS Lab/CN=caller' -out leaf/client.csr

openssl x509 -req -sha256 -days 30 \
  -in leaf/client.csr \
  -CA intermediate/intermediate-ca.crt \
  -CAkey intermediate/intermediate-ca.key \
  -CAcreateserial -extfile leaf/client.ext \
  -out leaf/client.crt
```

服务端要求客户端证书：

```bash
openssl s_server -accept 8443 \
  -cert leaf/api.example.com.crt \
  -cert_chain intermediate/intermediate-ca.crt \
  -key leaf/api.example.com.key \
  -Verify 2 -verify_return_error \
  -CAfile root/root-ca.crt \
  -chainCAfile intermediate/intermediate-ca.crt -www
```

客户端提供身份：

```bash
openssl s_client -connect 127.0.0.1:8443 \
  -servername api.example.com \
  -CAfile root/root-ca.crt \
  -cert leaf/client.crt \
  -cert_chain intermediate/intermediate-ca.crt \
  -key leaf/client.key \
  -verify_return_error </dev/null
```

不同 OpenSSL 版本对 `-cert_chain`、`-chainCAfile` 等选项的支持和语义可能有差异，实验前用 `openssl s_server -help` 与 `openssl s_client -help` 核对。生产服务应明确区分“发送给对端的链”和“验证对端时信任的 CA”。

## 8. 吊销与 CRL 的正确认识

`openssl x509 -req` 便于学习签发，但不维护 CA 数据库。要执行：

```bash
openssl ca -revoke leaf/api.example.com.crt
openssl ca -gencrl -out intermediate/intermediate-ca.crl
```

必须先为 `openssl ca` 配置 `database`、`serial`、`crlnumber`、策略和扩展，并用同一 CA 数据库完成签发。生产 CA 应由成熟 PKI 系统维护状态，不能混用无数据库签发与临时文本记录。

CRL 验证示意：

```bash
openssl verify -crl_check \
  -CAfile root/root-ca.crt \
  -untrusted intermediate/intermediate-ca.crt \
  -CRLfile intermediate/intermediate-ca.crl \
  leaf/api.example.com.crt
```

被吊销时应出现 `certificate revoked`。客户端是否主动获取和执行 CRL/OCSP 是另一层策略。

## 9. 清理与保密

实验目录包含根、中间和叶子私钥。完成后应销毁，不能提交到 Git。删除前确认目录只包含本次实验材料；生产私钥应遵循组织的数据销毁与审计制度。

## 10. 练习与答案

**问题：** 为什么服务端证书使用 EC，而 CA 使用 RSA 仍能工作？

叶子公钥算法与 CA 给证书签名的算法可以不同；客户端需同时支持并接受相应算法策略。

**问题：** CSR 中声明 `CA:TRUE`，CA 是否必须签出 CA 证书？

不必须，也不应该盲从。CA 应根据签发模板和授权策略决定最终扩展。

## 11. 参考资料

- [OpenSSL req](https://docs.openssl.org/master/man1/openssl-req/)
- [OpenSSL x509](https://docs.openssl.org/master/man1/openssl-x509/)
- [OpenSSL ca](https://docs.openssl.org/master/man1/openssl-ca/)
