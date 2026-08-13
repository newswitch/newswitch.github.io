---
title: openssl s_client 命令详解：SNI、证书链、协议、ALPN 与 mTLS
sidebar_position: 26
description: 系统讲解 openssl s_client connect/servername/showcerts/verify/CAfile/verify_hostname/brief/state/msg/tls/alpn/starttls/cert/key。
tags: [网络, OpenSSL, TLS, 证书, mTLS]
---

# `openssl s_client` 命令详解：握手成功不等于证书可信

`openssl s_client` 是通用 TLS 调试客户端，可显示握手、证书链、ALPN、session 和验证错误。它默认行为偏诊断：某些验证错误仍会继续并最终退出 0；自动化必须使用 `-verify_return_error` 并检查 hostname。

## 1. 连接与身份参数

```text
openssl s_client [OPTIONS]
```

| 参数 | 含义 |
|---|---|
| `-connect HOST:PORT` | TCP 目的，默认 localhost:4433 |
| `-servername NAME`、`-noservername` | SNI 名称/禁 SNI |
| `-name HOST` | 期望 server name（部分 starttls 场景） |
| `-4/-6` | 地址族 |
| `-proxy HOST:PORT`、`-proxy_user/-proxy_pass` | HTTP CONNECT 代理 |
| `-bind HOST:PORT` | 本地地址 |
| `-unix PATH` | Unix socket |

## 2. 验证与证书

| 参数 | 含义 |
|---|---|
| `-showcerts` | 显示服务端发来的证书列表，不代表已验证链 |
| `-CAfile FILE`、`-CApath DIR`、`-CAstore URI` | 信任来源 |
| `-verify DEPTH` | 启用验证并限制深度 |
| `-verify_return_error` | 验证错误立即失败 |
| `-verify_hostname NAME`、`-verify_ip IP` | 验证 SAN hostname/IP |
| `-partial_chain`、`-trusted_first` | chain 构建策略，需理解 PKI |
| `-status` | 请求 OCSP stapling |
| `-cert FILE`、`-key FILE`、`-cert_chain FILE` | mTLS client 身份 |
| `-pass SOURCE` | 私钥口令来源；避免明文 argv |

```bash
openssl s_client -connect api.example.com:443 \
  -servername api.example.com \
  -verify_hostname api.example.com -verify_return_error \
  -CAfile /etc/ssl/certs/ca-certificates.crt -brief </dev/null
```

## 3. 协议与调试

| 参数 | 含义 |
|---|---|
| `-tls1_2/-tls1_3`、`-min_protocol/-max_protocol` | TLS 版本 |
| `-cipher LIST`、`-ciphersuites LIST` | TLS 1.2-/1.3 cipher |
| `-alpn LIST`、`-nextprotoneg LIST` | 协议协商 |
| `-groups LIST`、`-sigalgs LIST` | key exchange groups/signature algorithms |
| `-brief`、`-state`、`-msg`、`-trace`、`-debug` | 递增细节与敏感风险 |
| `-starttls smtp\|imap\|postgres\|...` | 明文协议升级 TLS |
| `-sess_out/-sess_in`、`-reconnect` | session 保存/恢复测试 |
| `-keylogfile FILE` | TLS key log，可解密流量，极敏感 |

## 4. 证书链排障顺序

1. 固定 connect IP 和 SNI，避免测错虚拟主机。
2. 看 leaf SAN/有效期/key usage，不只 subject CN。
3. 区分 server sent chain 与本地 trust store 构建结果。
4. 检查中间证书顺序/缺失、根信任和 hostname。
5. 再看 protocol/cipher/group/ALPN 与 client certificate 请求。

## 5. 安全与验收

`-showcerts` 不会证明链可信；`Verify return code: 0` 也要确认启用了预期 hostname 和 trust store。`-msg/-trace/keylogfile` 会泄露协议细节或会话密钥，必须短时受控采集并安全删除。

掌握标准：能用 SNI+hostname+CA 完整验证，区分链发送/链构建/名称校验，定位 mTLS 与 ALPN 问题。

## 6. 官方参考

- [OpenSSL s_client](https://docs.openssl.org/master/man1/openssl-s_client/)

HTTP/TLS 网络命令补齐。返回 [网络命令参考库](./00-网络命令参考库学习路线.md)。
