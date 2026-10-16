---
title: "TLS 证书与握手故障排查 Runbook"
sidebar_label: "18. TLS 故障排查 Runbook"
sidebar_position: 18
description: "按 DNS、TCP、ClientHello、算法协商、证书链、主机名、mTLS 和 HTTP 分层定位 TLS 故障。"
tags: [TLS 排障, 证书错误, Runbook, OpenSSL]
---

# TLS 证书与握手故障排查 Runbook

不要从“重启 Nginx”开始。先确定失败发生在 DNS、TCP、TLS 哪个握手阶段、证书验证还是 TLS 之后的 HTTP。

![TLS 故障排查决策树](/img/networking/tls-pki/tls-troubleshooting.svg)

## 1. 五分钟分层

```text
1. DNS 是否得到预期 IP？
2. TCP 443 是否建立？
3. ClientHello 是否到达，SNI/ALPN 是否正确？
4. 双方是否有共同版本、Cipher、Group、Signature Scheme？
5. 证书链、主机名、时间、用途是否通过？
6. mTLS 客户端证书是否发送并受信任？
7. TLS 成功后 HTTP Host、Route、Auth 是否正确？
```

基线命令：

```bash
dig +short api.example.com
nc -vz api.example.com 443
openssl s_client -connect api.example.com:443 \
  -servername api.example.com \
  -verify_hostname api.example.com \
  -verify_return_error -showcerts </dev/null
curl -v https://api.example.com/healthz
```

## 2. 没有 ServerHello

检查：

- 请求是否到达正确 IP/端口；
- 监听程序是不是 TLS，是否误连明文 HTTP；
- SNI 是否路由到正确实例；
- 防火墙/WAF/代理是否丢弃 ClientHello；
- ClientHello 是否过大或分片触发旧设备问题；
- 服务端是否耗尽连接、文件描述符或握手队列。

用服务端抓包区分“没到达”和“到达但应用不响应”。

## 3. `wrong version number`

常见原因不是 TLS 版本太旧，而是对 TLS 客户端返回了明文 HTTP：

```text
客户端连接 443
实际端口却是 HTTP
```

先用 `nc`/Curl 和抓包查看对端首字节，再检查 Service TargetPort、Ingress Backend Protocol 和代理链。

## 4. `unsupported protocol` / `protocol version`

双方没有共同 TLS 版本。分别强制测试 TLS 1.2/1.3，检查客户端密码库版本、服务端最低版本和中间代理。不要为了旧客户端直接恢复 TLS 1.0，应确认资产、升级路径和风险例外。

## 5. `no shared cipher` 或握手失败

对 TLS 1.2 检查 Cipher List、证书类型和签名支持；对 TLS 1.3 分别检查：

- Ciphersuite；
- Supported Group/Key Share；
- Signature Algorithm；
- 证书密钥类型和安全级别策略。

看到一个共同 Cipher 名称不代表整个协商一定兼容。

## 6. `unable to get local issuer certificate`

可能是：

- 服务端漏发中间证书；
- 客户端缺少根信任；
- 链顺序/对象错误；
- 客户端使用另一 Trust Store；
- 路径构建被算法或约束拒绝。

分别收集服务端发送链和客户端本地 CA：

```bash
openssl s_client -connect api.example.com:443 \
  -servername api.example.com -showcerts </dev/null

openssl verify -CAfile root.crt \
  -untrusted intermediate.crt server.crt
```

## 7. 主机名不匹配

确认访问的是域名还是 IP，并查看 SAN：

```bash
openssl x509 -in server.crt -noout -ext subjectAltName
```

不要通过 `curl -k` 关闭验证。若要指定目标 IP，用 `--resolve` 保留 URL、SNI 和 Host。

## 8. 时间错误

```bash
date -u
timedatectl status
openssl x509 -in server.crt -noout -dates
```

证书未生效/过期可能来自客户端时间漂移、证书确实过期、数据面仍加载旧证书或时区解释错误。X.509 时间按绝对时间比较，不是把显示时区改一下就能修复。

## 9. 私钥不匹配或无法加载

症状可能出现在服务启动/Reload：

```text
key values mismatch
PEM routines: no start line
bad decrypt
permission denied
```

检查对象类型、密码、权限、SELinux/AppArmor、文件原子更新和公钥摘要。不要把私钥内容输出到日志。

## 10. mTLS 错误

| 错误 | 方向 | 检查 |
| --- | --- | --- |
| `certificate required` | 服务端拒绝客户端 | 客户端是否发送 cert/key |
| `unknown ca` | 验证端不信任 | 客户端链和服务端 Client CA Bundle |
| `bad certificate` | 证书/签名不接受 | EKU、有效期、算法、私钥匹配 |
| TLS 成功后 403 | 应用授权 | 证书身份到主体的映射与策略 |

双向确认错误来自哪一端，因为客户端和服务端都可能报告 `unknown ca`。

## 11. 部分实例失败

若同一域名偶发返回不同证书：

```bash
for ip in 192.0.2.10 192.0.2.11; do
  echo | openssl s_client -connect "$ip:443" \
    -servername api.example.com 2>/dev/null |
    openssl x509 -noout -serial -dates -subject
done
```

检查 LB 后端、Pod、CDN POP、IPv4/IPv6 和不同地域入口。平均监控可能掩盖一台未轮换实例。

## 12. TLS 成功但业务失败

出现以下证据后转入 HTTP/应用排障：

- Verify Return Code 为成功；
- ALPN 正确；
- 收到 HTTP 状态码；
- TLS Alert 没有出现。

继续检查 Host、Path、JWT、Cookie、网关路由、上游 TLS、连接池和后端依赖，不要继续替换公网证书。

## 13. 变更与回滚

修复证书时保留：

- 原证书序列号和备份位置；
- 新旧证书链与私钥匹配证据；
- 配置语法检查；
- Canary 实例和真实域名验证；
- 回滚文件及 Reload 方法；
- 长连接排空策略。

不要边排障边删除唯一旧私钥或根信任。

## 14. 练习与答案

**问题：** 所有浏览器正常，只有一个 Java 服务报 PKIX path building failed，优先查什么？

比较 Java Truststore 与系统/浏览器信任库，并检查服务端是否漏发中间证书、JVM 算法策略是否拒绝链。

**问题：** 新证书 Secret 已更新，但外部仍看到旧证书，问题可能在哪？

Controller 未 Watch/无权限、数据面未 Reload、流量终止在更前面的 CDN/LB、部分实例未同步，或 DNS/IPv6 指向另一入口。

## 15. 参考资料

- [OpenSSL Verification Options](https://docs.openssl.org/master/man1/openssl-verification-options/)
- [RFC 8446 Alerts](https://www.rfc-editor.org/rfc/rfc8446#section-6)
