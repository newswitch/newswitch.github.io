---
title: curl 命令详解：DNS、TCP、TLS、HTTP、超时、重试与指标
sidebar_position: 25
description: 系统讲解 curl URL/请求/头/body/auth/proxy/TLS/resolve/connect-to、超时重试、fail、write-out、trace 与生产安全。
tags: [网络, curl, HTTP, TLS, SRE]
---

# `curl` 命令详解：把应用链路拆成可观测阶段

`curl` 支持大量协议，AI Infra/SRE 最常用的是 HTTP(S)：DNS → 建连 → TLS → request upload → server processing → response download。curl 传输成功默认不把 HTTP 404/500 当命令失败，自动化必须明确成功定义。

## 1. 请求参数族

```text
curl [OPTIONS] URL...
```

| 类别 | 参数 | 含义 |
|---|---|---|
| method | `-X, --request`、`-I, --head`、`-G, --get` | 显式 method、HEAD、把 data 放 query |
| body | `-d, --data`、`--data-binary`、`--json`、`-F, --form`、`-T, --upload-file` | form/raw JSON/multipart/upload |
| headers | `-H, --header`、`-A, --user-agent`、`-e, --referer` | 请求头 |
| auth | `-u, --user`、`--oauth2-bearer`、`--netrc-file`、`--aws-sigv4` | 身份认证 |
| output | `-o FILE`、`-O, --remote-name`、`-D FILE`、`-i, --show-headers`、`-sS` | body/header/安静但保留错误 |
| redirect | `-L, --location`、`--max-redirs`、`--proto-redir` | 跟随跳转与协议限制 |
| compression | `--compressed` | 请求压缩响应并自动解压 |

不要用 `-X POST` 配 `-d` 作为习惯；`-d` 已选择合适 method，重定向时 `-X` 还可能把原 method 强行带到下一跳。

## 2. DNS、地址与代理

| 参数 | 含义 |
|---|---|
| `-4/--ipv4`、`-6/--ipv6` | 限地址族 |
| `--resolve HOST:PORT:ADDR` | 自定义 DNS 映射，仍保持 URL host/SNI |
| `--connect-to HOST1:PORT1:HOST2:PORT2` | 改实际连接目的，不改应用 host |
| `--interface IFACE`、`--local-port RANGE` | 指定出口/源端口 |
| `-x, --proxy`、`--noproxy` | 代理与绕过 |
| `--dns-servers` | 自定义 DNS server（需 resolver backend 支持） |

```bash
curl -sS --resolve api.example.com:443:10.0.0.20 \
  https://api.example.com/health
```

## 3. TLS 安全

| 参数 | 含义 |
|---|---|
| `--cacert FILE`、`--capath DIR` | 信任根 |
| `--cert FILE`、`--key FILE`、`--cert-type/--key-type` | mTLS client 证书 |
| `--tlsv1.2/--tlsv1.3`、`--tls-max`、`--ciphers/--tls13-ciphers` | 版本与 cipher |
| `--pinnedpubkey HASHES` | 公钥 pin（需运维轮换设计） |
| `-k, --insecure` | 禁证书校验，生产诊断也不应当作修复 |

`-k` 会同时失去 CA/hostname authenticity，可能把中间人响应误判为服务健康。

## 4. 超时、失败与重试

| 参数 | 含义 |
|---|---|
| `--connect-timeout SEC` | 建连阶段上限 |
| `-m, --max-time SEC` | 单次 transfer 总上限 |
| `--speed-limit N --speed-time SEC` | 低速阈值 |
| `-f, --fail`、`--fail-with-body` | HTTP 4xx/5xx 非零；后者保留 body |
| `--retry N`、`--retry-delay SEC`、`--retry-max-time SEC` | 瞬态重试及总窗口 |
| `--retry-connrefused`、`--retry-all-errors` | 扩展重试条件，后者易造成重复副作用 |

对 POST/PUT 等非幂等请求不要盲目 retry；服务端可能已经处理而响应丢失。redirected input/pipe 也不一定可安全重放。

## 5. 时间指标与 trace

```bash
curl -sS --fail-with-body --connect-timeout 2 --max-time 10 \
  -o response.json \
  -w 'code=%{response_code} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} remote=%{remote_ip}\\n' \
  https://api.example.com/health
```

`-v` 显示协议调试，`--trace/--trace-ascii FILE` 更完整；两者可能记录 Authorization、Cookie、query secret 和 body，必须脱敏并限制权限。

## 6. 验收与参考

能区分 DNS/connect/TLS/TTFB/total，定义 HTTP 失败、设计安全 retry，使用 resolve 排除 DNS 且保留 SNI，并避免 `-k` 和 trace 泄密。

- [curl command line manual](https://curl.se/docs/manpage.html)

下一篇：[openssl s_client 命令详解](./26-openssl-s_client命令详解.md)。
