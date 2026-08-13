---
title: dig 命令详解：DNS 递归、权威、DNSSEC 与加密查询
sidebar_position: 13
description: 以 BIND 9.20 为基线，系统讲解 dig 命令行和查询选项、DNS 报文、记录类型、递归与权威定位、DNSSEC、DoT/DoH 及自动化判定。
tags: [Linux, dig, DNS, DNSSEC, DoT, DoH, 网络排障]
---

# `dig` 命令详解：DNS 递归、权威、DNSSEC 与加密查询

`dig` 是 BIND 提供的 DNS 查询与诊断工具。它既能查询系统默认递归解析器，也能绕过本机配置直接询问指定服务器；既能看简短地址，也能检查响应头、权威区、附加区、EDNS、DNSSEC 和传输方式。

`dig` 适合回答：

- 查询实际发给了哪个 DNS 服务器；
- 响应是成功、无记录、NXDOMAIN，还是服务器失败；
- 递归缓存与权威服务器看到的答案是否一致；
- CNAME、委派、Glue、负缓存和 TTL 位于哪一层；
- DNSSEC 的 DO、AD、CD 标志和签名链是什么状态；
- UDP、TCP、DoT、DoH 的结果是否存在差异。

## 1. 版本、语法与安全

本文以 BIND 9.20.26 文档为基线。先检查发行版实际版本：

```bash
dig -v
dig -h
man dig
```

基本语法：

```text
dig [@服务器] [全局命令行选项] 名称 [类型] [类别] [+查询选项]
dig [全局选项] -x IP地址 [+查询选项]
dig [全局选项] -f 批处理文件
```

| 项目 | 说明 |
|---|---|
| 安全级别 | `[R]`，但会向 DNS 服务发出查询 |
| 生产影响 | 单次查询很小；高并发、`+trace`、批处理和大范围枚举会增加多级 DNS 流量 |
| 凭据安全 | 不要把 TSIG secret 写在 `-y` 命令行；它可能出现在历史记录和进程列表，优先使用 `-k` |
| 基线习惯 | 显式写 `@server`、记录类型、`+time`、`+tries` 和地址族，保证结果可复现 |

## 2. 先理解 DNS 响应

```text
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 12345
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

;; QUESTION SECTION:
;www.example.com.       IN A

;; ANSWER SECTION:
www.example.com.  300   IN A      192.0.2.10
```

### 常见头部标志

| 标志 | 含义 |
|---|---|
| `qr` | 这是响应报文 |
| `aa` | 权威回答 |
| `tc` | 响应被截断，客户端通常应改用 TCP |
| `rd` | 客户端请求递归 |
| `ra` | 服务器声明支持递归 |
| `ad` | 验证型解析器认为相关数据通过 DNSSEC 验证 |
| `cd` | 客户端要求服务器关闭 DNSSEC 验证检查 |

### 常见状态码

| 状态 | 含义 | 排查方向 |
|---|---|---|
| `NOERROR` 且有 Answer | 查询成功且存在该类型数据 | 检查值与 TTL |
| `NOERROR` 且无 Answer | 名称存在但该记录类型不存在，常称 NODATA | 看 Authority 中 SOA、检查类型 |
| `NXDOMAIN` | 域名不存在 | 检查拼写、搜索域、负缓存和权威 SOA |
| `SERVFAIL` | 服务器无法完成查询 | DNSSEC 验证、上游、委派、超时或权威故障 |
| `REFUSED` | 服务器按策略拒绝查询 | ACL、递归权限、视图、来源地址 |
| `FORMERR` | 请求格式不被接受 | EDNS、Cookie、服务实现或中间设备 |

`dig` 收到 NXDOMAIN 时通常仍以退出码 0 结束，因为它成功收到了一份 DNS 响应。自动化不能只判断 `$?`，还必须解析 `status:` 和 Answer。

## 3. 命令行选项

| 参数 | 作用 |
|---|---|
| `@server` | 指定 DNS 服务器；可写地址或名称，排障优先写地址避免再次依赖 DNS |
| `-4` | 只用 IPv4 与 DNS 服务器通信 |
| `-6` | 只用 IPv6 与 DNS 服务器通信 |
| `-b address[#port]` | 绑定本地源地址，可附源端口 |
| `-c class` | 指定 DNS 类别，通常是 `IN` |
| `-f file` | 从文件批量读取查询 |
| `-h` | 显示帮助 |
| `-k keyfile` | 从文件读取 TSIG 密钥 |
| `-m` | 开启内存使用调试，普通排障不需要 |
| `-p port` | 指定服务器端口，默认 53 |
| `-q name` | 显式指定查询名，适合脚本消除位置参数歧义 |
| `-r` | 不读取用户的 `${HOME}/.digrc`，自动化推荐使用 |
| `-t type` | 指定记录类型 |
| `-u` | 显示以微秒计的查询时间 |
| `-v` | 显示版本 |
| `-x address` | 构造 IPv4/IPv6 反向 PTR 查询 |
| `-y [hmac:]name:secret` | 在命令行提供 TSIG；存在 secret 泄露风险，优先 `-k` |

`-b` 只能绑定本机已有地址，且内核路由策略必须允许该源地址：

```bash
ip route get 192.0.2.53 from 192.0.2.10
dig -4 -b 192.0.2.10 @192.0.2.53 www.example.com A
```

## 4. 常见记录类型

| 类型 | 作用 | 示例 |
|---|---|---|
| `A` | IPv4 地址 | `dig example.com A` |
| `AAAA` | IPv6 地址 | `dig example.com AAAA` |
| `CNAME` | 别名指向规范名称 | `dig www.example.com CNAME` |
| `MX` | 邮件交换服务器与优先级 | `dig example.com MX` |
| `NS` | 区域权威服务器 | `dig example.com NS` |
| `SOA` | 区域起始授权、序列号和负缓存相关参数 | `dig example.com SOA` |
| `TXT` | 文本数据，常用于验证/SPF 等 | `dig example.com TXT` |
| `SRV` | 服务位置、端口、优先级和权重 | `dig _service._tcp.example.com SRV` |
| `PTR` | 地址反向名称 | `dig -x 192.0.2.10` |
| `CAA` | 哪些 CA 可为域签发证书 | `dig example.com CAA` |
| `SVCB` / `HTTPS` | 服务绑定与 HTTPS 参数 | `dig example.com HTTPS` |
| `DNSKEY` | 区域 DNSSEC 公钥 | `dig example.com DNSKEY +dnssec` |
| `DS` | 父区保存的子区密钥摘要 | `dig example.com DS +dnssec` |
| `RRSIG` | RRset 的 DNSSEC 签名 | `dig example.com A +dnssec` |

`ANY` 不是“拿到所有记录”的可靠方式。服务器可以最小化、拒绝或只返回部分数据；明确查询所需类型。

## 5. 输出控制选项

查询选项以 `+` 开启，许多选项可用 `+no...` 关闭。

| 选项 | 作用 |
|---|---|
| `+short` | 仅显示简短答案；适合人工取值，不适合独立判断健康 |
| `+noall` | 关闭多数输出，通常再显式开启某些区段 |
| `+answer` / `+noanswer` | 显示/隐藏 Answer |
| `+authority` / `+noauthority` | 显示/隐藏 Authority |
| `+additional` / `+noadditional` | 显示/隐藏 Additional |
| `+question` / `+noquestion` | 显示/隐藏 Question |
| `+comments` / `+nocomments` | 显示/隐藏注释 |
| `+stats` / `+nostats` | 显示/隐藏耗时、服务器、时间和报文大小 |
| `+cmd` / `+nocmd` | 显示/隐藏开头的 dig 版本和全局选项 |
| `+identify` | 配合 `+short` 显示提供答案的服务器及端口 |
| `+ttlunits` | 用可读时间单位显示 TTL |
| `+multiline` | 多行、带注释地显示较长记录 |
| `+split=N` | 将十六进制或 base64 字段按宽度分段；0 表示不分段 |
| `+unknownformat` | 以通用未知 RR 格式显示不熟悉的类型 |

只显示答案但保留 TTL 和类型：

```bash
dig @192.0.2.53 www.example.com A +noall +answer
```

## 6. 递归、缓存与权威查询

| 选项 | 作用 |
|---|---|
| `+recurse` / `+norecurse` | 设置/清除 RD 位；默认请求递归 |
| `+aaonly` / `+noaaonly` | 设置/清除 AA 请求相关标志；实际权威性仍看响应 `aa` |
| `+trace` | 从根服务器开始迭代跟踪委派链；会产生多次查询 |
| `+nssearch` | 找到区域权威服务器并查询 SOA，比较权威状态 |
| `+domain=NAME` | 设置搜索域，影响 `+search` |
| `+search` / `+nosearch` | 使用/不使用搜索列表 |
| `+showsearch` | 显示搜索过程中的中间查询结果 |

### 递归解析器与权威服务器对比

```bash
# 系统配置的递归解析器
dig -r www.example.com A

# 指定递归解析器
dig -r @192.0.2.53 www.example.com A

# 查委派链
dig -r www.example.com A +trace

# 找到 NS 后，直接问某台权威服务器且不请求递归
dig -r @ns1.example.net www.example.com A +norecurse
```

判断缓存问题时，比较递归结果和权威结果的值与 TTL。不要把 `+trace` 结果直接等同于客户端结果：客户端通常使用递归解析器，而 `+trace` 是本机直接进行迭代查询，网络与策略路径不同。

## 7. 超时、重试与传输

| 选项 | 作用 |
|---|---|
| `+time=T` | 单次查询等待秒数，BIND 9.20 默认 5 秒 |
| `+tries=T` | 总尝试次数，包含第一次 |
| `+retry=T` | 首次之后的重试次数，不包含第一次 |
| `+tcp` / `+vc` | 使用 TCP |
| `+notcp` / `+novc` | 使用 UDP（一般默认） |
| `+ignore` | UDP 响应截断时不自动切换 TCP |
| `+keepopen` | TCP 模式下在批量查询间保持连接 |
| `+bufsize=N` | 设置 EDNS 通告的 UDP 缓冲大小 |

快速、可控的健康检查：

```bash
dig -r -4 @192.0.2.53 www.example.com A +time=2 +tries=1
```

比较 UDP 与 TCP：

```bash
dig -r @192.0.2.53 example.com DNSKEY +dnssec +notcp
dig -r @192.0.2.53 example.com DNSKEY +dnssec +tcp
```

UDP 失败而 TCP 成功时，检查 MTU、分片、ACL、NAT、EDNS 缓冲和中间设备；不能简单归因于“DNS 服务故障”。

## 8. EDNS、Cookie 与客户端子网

| 选项 | 作用 |
|---|---|
| `+edns[=N]` | 使用指定 EDNS 版本 |
| `+noedns` | 不使用 EDNS |
| `+ednsflags[=BITS]` | 设置 EDNS 标志位 |
| `+ednsopt[=CODE[:VALUE]]` | 添加 EDNS 选项 |
| `+noednsopt` | 清除 EDNS 选项 |
| `+cookie[=HEX]` | 发送 DNS Cookie，可提供指定客户端 Cookie |
| `+nocookie` | 不发送 Cookie |
| `+subnet=ADDR/PREFIX` | 添加 EDNS Client Subnet；会影响 CDN/地域答案和隐私 |
| `+nosubnet` | 不发送 ECS |
| `+expire` | 请求 EDNS Expire 选项 |
| `+nsid` | 请求服务器 NSID |

ECS 会把部分客户端网络信息传给 DNS 链路并可能改变答案。排障必须明确记录是否使用，不要把带 ECS 和不带 ECS 的响应直接比较。

## 9. DNSSEC 查询与验证

| 选项 | 作用 |
|---|---|
| `+dnssec` | 在 EDNS 中设置 DO 位，请求 DNSSEC 相关记录 |
| `+nodnssec` | 不设置 DO 位 |
| `+adflag` / `+noadflag` | 设置/清除查询中的 AD 位 |
| `+cdflag` / `+nocdflag` | 设置/清除 CD 位；`+cdflag` 要求递归器不要替客户端拒绝验证失败数据 |
| `+sigchase` | 部分版本或构建中的签名追踪能力；以本机帮助为准 |

```bash
# 让验证型递归解析器返回验证结果
dig -r @192.0.2.53 www.example.com A +dnssec

# 查询签名材料
dig -r @192.0.2.53 example.com DNSKEY +dnssec
dig -r @192.0.2.53 example.com DS +dnssec

# 对比关闭服务器验证后的响应，只用于诊断
dig -r @192.0.2.53 www.example.com A +dnssec +cdflag
```

看到 `ad` 表示所询问的验证型解析器声明验证成功，不代表本机独立验证了整条链。没有 `ad` 也不一定是失败：服务器可能不是验证型解析器，信任锚或策略也可能不同。

## 10. DoT、DoH 与 HTTP 传输

BIND 9.20 的 `dig` 可支持加密 DNS 传输，但发行版构建和版本差异较大，先以 `dig -h` 为准。

| 选项 | 作用 |
|---|---|
| `+tls` | 使用 DNS over TLS |
| `+tls-ca[=FILE]` | 使用系统或指定 CA 验证服务器证书 |
| `+tls-hostname=NAME` | 验证 TLS 服务器名称 |
| `+tls-certfile=FILE` | 提供客户端证书 |
| `+tls-keyfile=FILE` | 提供客户端私钥 |
| `+https[=ENDPOINT]` | 使用 DNS over HTTPS，可指定 endpoint |
| `+https-get` | DoH 使用 GET |
| `+https-post` | DoH 使用 POST |
| `+http-plain[=ENDPOINT]` | 明文 HTTP DNS，用于测试，不提供传输机密性 |

示意命令：

```bash
dig -r @192.0.2.853 example.com A -p 853 +tls \
  +tls-hostname=dns.example.net +tls-ca
```

不要用 `+tls` 成功就推断证书得到验证；必须明确提供 CA 与期望主机名，并检查版本的验证行为。`+http-plain` 不是安全的 DoH。

## 11. 其他常用查询行为

| 选项 | 作用 |
|---|---|
| `+header-only` | 发送只有 DNS 头、无 Question 的查询，常规排障少用 |
| `+opcode=VALUE` | 指定 DNS opcode，协议测试用途 |
| `+qr` | 设置查询中的 QR 位，普通查询不要使用 |
| `+raflag` | 设置查询中的 RA 位，协议测试用途 |
| `+tcflag` | 设置查询中的 TC 位，协议测试用途 |
| `+zflag` | 设置保留位，协议测试用途 |
| `+besteffort` | 尝试显示格式异常的响应，而不是立即放弃 |
| `+qr` / `+noqr` | 显示发送出去的查询报文；注意和设置 QR 位的版本语义核对 |

低频协议测试选项容易随 BIND 版本发生变化。执行前应查看 `dig -h` 和对应版本手册，不要在生产 DNS 上进行未经批准的异常报文测试。

## 12. 退出码与自动化

BIND 9.20 文档定义的主要退出码：

| 退出码 | 含义 |
|---|---|
| `0` | 收到 DNS 响应，包括可能的 NXDOMAIN/SERVFAIL 等响应状态 |
| `1` | 使用错误 |
| `8` | 无法打开批处理文件 |
| `9` | 没有收到服务器回复 |
| `10` | 内部错误 |

因此健康检查至少要区分三层：

```text
进程层：dig 是否执行、是否收到响应
协议层：HEADER status 是 NOERROR / NXDOMAIN / SERVFAIL / REFUSED...
数据层：Answer 是否存在，值、TTL、记录类型是否符合预期
```

Shell 示例只做演示，严肃自动化建议使用 DNS 库解析报文：

```bash
output=$(dig -r @192.0.2.53 www.example.com A +time=2 +tries=1)
rc=$?
printf '%s\n' "$output"
printf 'dig_exit=%s\n' "$rc"
```

不要用 `dig +short` 的非空/空作为唯一判断，因为 CNAME、NODATA、SERVFAIL、超时和输出格式差异可能混在一起。

## 13. 一套从客户端到权威的排障顺序

```bash
# 1. 看系统实际 DNS 配置与路由
resolvectl status

# 2. 通过系统解析链查询
resolvectl query www.example.com

# 3. 直接问系统声明的递归服务器
dig -r @192.0.2.53 www.example.com A +time=2 +tries=1

# 4. 比较 UDP/TCP
dig -r @192.0.2.53 www.example.com A +tcp +time=2 +tries=1

# 5. 检查委派链
dig -r www.example.com A +trace

# 6. 直接问权威服务器
dig -r @ns1.example.net www.example.com A +norecurse

# 7. 查看线上请求与响应
sudo tcpdump -i any -nn -c 100 'port 53'
```

在容器或 Kubernetes 中，还要检查 Pod 的 `/etc/resolv.conf`、搜索域、`ndots`、CoreDNS 日志/指标、NetworkPolicy 和节点到上游 DNS 的路径。

## 14. 常见误区

| 误区 | 正确认识 |
|---|---|
| `dig` 正常就说明应用解析正常 | 应用可能走 NSS、缓存、代理、systemd-resolved、JVM 或自带 DNS 库 |
| `+short` 空就是域名不存在 | 可能是 NODATA、SERVFAIL、REFUSED、超时或输出被裁剪 |
| NXDOMAIN 时退出码一定非 0 | `dig` 成功收到 NXDOMAIN 响应时通常退出 0 |
| `+trace` 等同于客户端解析 | `+trace` 自行迭代，绕过客户端原来的递归解析链 |
| Answer 没变化就是缓存没问题 | TTL、负缓存、CNAME 链、ECS、DNS 视图也必须核对 |
| 有 `ad` 就是本机独立完成验证 | 它通常是递归解析器给出的验证声明 |
| DoT/DoH 连通就一定安全 | 还要验证证书链、主机名和实际 endpoint |

## 15. 官方资料

- [BIND 9.20 `dig` 手册](https://bind9.readthedocs.io/en/v9.20.26/manpages.html#dig-dns-lookup-utility)
- [IANA DNS 参数注册表](https://www.iana.org/assignments/dns-parameters/dns-parameters.xhtml)
- [RFC 1034：DNS Concepts and Facilities](https://www.rfc-editor.org/rfc/rfc1034)
- [RFC 1035：DNS Implementation and Specification](https://www.rfc-editor.org/rfc/rfc1035)

