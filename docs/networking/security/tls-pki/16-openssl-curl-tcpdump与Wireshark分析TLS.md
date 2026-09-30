---
title: "使用 OpenSSL、Curl、Tcpdump 与 Wireshark 分析 TLS"
sidebar_label: "16. TLS 观测与抓包"
sidebar_position: 16
description: "用分层命令验证 DNS、TCP、SNI、ALPN、证书链、主机名、mTLS 和应用响应，并读懂典型输出。"
tags: [OpenSSL, Curl, Tcpdump, Wireshark, TLS 排障]
---

# 使用 OpenSSL、Curl、Tcpdump 与 Wireshark 分析 TLS

工具选择取决于问题层次。`nc` 证明端口可连接，`openssl s_client` 观察 TLS，Curl 继续验证 HTTP，Tcpdump/Wireshark 用于确认网络上真实发生了什么。

## 1. 分层检查

```text
DNS → IP 路由 → TCP → TLS 协商 → 证书验证 → HTTP → 应用
```

```bash
dig +short api.example.com
nc -vz api.example.com 443
openssl s_client ...
curl -v ...
```

不要把某一层成功外推为整条链成功。

## 2. s_client 基础检查

```bash
openssl s_client \
  -connect api.example.com:443 \
  -servername api.example.com \
  -verify_hostname api.example.com \
  -verify_return_error \
  -showcerts </dev/null
```

典型成功片段：

```text
subject=CN = api.example.com
issuer=CN = Example Issuing CA
Verification: OK
Protocol  : TLSv1.3
Cipher    : TLS_AES_128_GCM_SHA256
Verify return code: 0 (ok)
```

不同 OpenSSL 版本格式会变化，应关注语义而不是固定行号。

## 3. 连接指定 IP 并保持 SNI

```bash
openssl s_client \
  -connect 192.0.2.10:443 \
  -servername api.example.com \
  -verify_hostname api.example.com \
  -CAfile ca-bundle.crt \
  -verify_return_error </dev/null
```

这能区分 DNS 返回地址问题与目标实例 TLS 配置问题。

## 4. 查看 ALPN 与版本

```bash
openssl s_client -connect api.example.com:443 \
  -servername api.example.com \
  -alpn 'h2,http/1.1' -tls1_3 </dev/null
```

关注：

```text
ALPN protocol: h2
```

若出现 `no application protocol`，对比两端支持列表和代理配置。

## 5. mTLS

```bash
openssl s_client -connect mtls.example.com:443 \
  -servername mtls.example.com \
  -CAfile server-ca.crt \
  -cert client.crt -key client.key \
  -verify_return_error </dev/null
```

服务端可能给出可接受 CA 列表，但列表为空不必然代表不验证客户端证书；以最终握手和服务端策略为准。

## 6. Curl 分段计时

```bash
curl --silent --show-error --output /dev/null \
  --write-out 'remote=%{remote_ip} dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  https://api.example.com/healthz
```

近似分解：

```text
DNS       = time_namelookup
TCP       = time_connect - time_namelookup
TLS增量   = time_appconnect - time_connect
应用等待   = time_starttransfer - time_appconnect
```

代理、连接复用、Happy Eyeballs 和 Curl 版本会影响解释，应记录完整命令与环境。

## 7. 提取服务端叶子证书

```bash
openssl s_client -connect api.example.com:443 \
  -servername api.example.com </dev/null 2>/dev/null |
openssl x509 -noout -subject -issuer -serial -dates \
  -fingerprint -sha256 -ext subjectAltName
```

管道可能只提取第一张证书，不能替代 `-showcerts` 对完整链的检查。

## 8. Tcpdump

```bash
sudo tcpdump -i any -nn -s 0 \
  'host 192.0.2.10 and tcp port 443' \
  -w tls-failure.pcap
```

采集前确认：

- 客户端和服务端时间同步；
- 是否经过 NAT/LB；
- 抓包点在加密前还是后；
- 文件是否包含用户数据和敏感元数据；
- 是否需要双向、双端同时抓取。

## 9. Wireshark 过滤器

```text
tls
tls.handshake.type == 1       # ClientHello
tls.handshake.type == 2       # ServerHello
tls.alert_message
tcp.flags.reset == 1
tcp.analysis.retransmission
```

字段名称可能随 Wireshark 版本和 QUIC 解析变化。

## 10. 解密现代 TLS

ECDHE 会话通常不能仅靠服务端私钥解密。受控客户端可通过运行时支持导出 NSS Key Log，例如：

```bash
SSLKEYLOGFILE=/secure/path/tls.keys curl https://api.example.com/
```

并非所有 Curl/OpenSSL 构建都支持。Key Log 等价于会话解密材料，应限制权限、仅用于受控测试并及时销毁，不能上传公共工单。

## 11. 证据模板

```text
时间/时区：
客户端地址与版本：
DNS 结果：
目标 IP/端口：
SNI/ALPN：
协商版本/Cipher：
叶子序列号/SAN/有效期：
服务端发送链：
本地 Trust Store：
最后一条 TLS 消息/Alert：
HTTP 状态与 TTFB：
```

## 12. 练习与答案

**问题：** `s_client` 最后显示证书内容，命令退出码为 0，是否一定验证成功？

不一定。某些用法会继续连接并打印验证错误；应使用 `-verify_return_error`、主机名验证并检查 Verify Return Code。

**问题：** 为什么有服务端私钥仍解不开 TLS 1.3 Pcap？

流量密钥来自临时 ECDHE 共享秘密，不由证书私钥直接决定。应使用端点 Key Log 或端点内部观测。

## 13. 参考资料

- [OpenSSL s_client](https://docs.openssl.org/master/man1/openssl-s_client/)
- [Curl Write-Out](https://curl.se/docs/manpage.html#-w)
- [Wireshark TLS Wiki](https://wiki.wireshark.org/TLS)
