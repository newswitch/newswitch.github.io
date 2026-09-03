---
title: "ICMP、UDP、TCP、DNS 与连接诊断"
sidebar_label: "04. ICMP、UDP、TCP、DNS 与连接诊断"
sidebar_position: 4
description: "理解常用传输和诊断协议，掌握握手、重传、窗口、DNS 解析及端到端连接排查。"
tags: [ICMP, UDP, TCP, DNS, MTU, Socket]
---

# ICMP、UDP、TCP、DNS 与连接诊断

## 1. “网络通”至少有四种含义

```text
三层可达
≠ 目标端口可达
≠ 应用协议正确
≠ 用户请求满足 SLO
```

`ping` 成功只证明某类 ICMP 往返成功。TCP 端口可能被防火墙拒绝，TLS 可能失败，
HTTP 也可能返回 500。

## 2. ICMP

ICMP 用于报告 IP 转发和诊断信息，常见消息包括：

- Echo Request/Reply：`ping` 使用。
- Destination Unreachable：网络、主机、协议或端口不可达。
- Time Exceeded：TTL 归零，`traceroute` 利用它识别中间跳点。
- Packet Too Big / Fragmentation Needed：路径 MTU 发现的重要反馈。

### 2.1 traceroute 的本质 {/* #traceroute-的本质 */}

发送 TTL 从 1 递增的探测包：

```text
TTL=1 → 第一跳返回 Time Exceeded
TTL=2 → 第二跳返回 Time Exceeded
...
到达目的 → 返回终止响应
```

某一跳不响应不等于它不转发。设备可能转发业务流量但限制或过滤 ICMP 响应。

### 2.2 PMTUD {/* #pmtud */}

路径 MTU 发现依赖 ICMP 反馈。若中间设备丢弃必要 ICMP，可能出现：

- 小包正常，大包失败。
- TCP 握手成功，传输数据时卡住。
- TLS ClientHello 或大响应超时。

验证：

```bash
tracepath <destination>
ping -M do -s 1472 <destination>
```

`1472 + 20 字节 IPv4 头 + 8 字节 ICMP 头 = 1500`。隧道环境需为额外封装留空间。

## 3. UDP

UDP 提供无连接的数据报传输：

- 无三次握手。
- 协议本身不保证到达、顺序和重传。
- 应用需要自行处理超时、重试、去重和拥塞。
- 一个方向能发送不代表返回路径或应用端口正常。

UDP 常用于 DNS、NTP、遥测和实时媒体。QUIC 运行在 UDP 之上，但自己实现可靠性、
拥塞控制和加密连接管理。

查看 UDP Socket：

```bash
ss -lunp
```

UDP 没有 TCP 握手状态机，但操作系统允许对 UDP Socket 调用 `connect`，关联默认对端；某些工具将其显示为 `ESTAB`。这不是线上建立了可靠连接，也不同于防火墙的 UDP 会话状态。

### 3.1 数据报边界与无响应的含义

UDP 保留数据报边界，不会像 TCP 那样把连续发送自动呈现为字节流。接收缓冲参数太小可能截断单份数据报，剩余部分不会在下一次读取中作为其后半段返回；接口通过返回值或标志报告相关状态。

发送成功通常只说明本机接受了数据。无监听端口可能反馈 ICMP 错误，但错误可能被过滤、限速或未交给应用。“超时无回复”不能证明端口开放或关闭，请求 ID、超时、幂等和重试仍需由应用定义。见 [Linux UDP](https://man7.org/linux/man-pages/man7/udp.7.html)。

## 4. TCP 连接生命周期

### 4.1 三次握手 {/* #三次握手 */}

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    C->>S: SYN, seq=x
    S->>C: SYN+ACK, seq=y, ack=x+1
    C->>S: ACK, ack=y+1
```

它用于确认双向可达并同步初始序列号。常见现象：

| 抓包 | 推断 |
| --- | --- |
| SYN 发出，无响应 | 去程丢弃、对端未收到、回程丢弃 |
| SYN 后立即 RST | 端口未监听或策略主动拒绝 |
| SYN/SYN-ACK 重复 | 最后 ACK 丢失或状态设备不一致 |
| 握手成功后超时 | 应用、TLS、MTU、窗口或中间状态问题 |

### 4.2 可靠性机制 {/* #可靠性机制 */}

- 序列号与 ACK：确认字节流位置。
- 重传：超时或重复 ACK/SACK 触发。
- 接收窗口：接收方通告可用缓冲区。
- 拥塞窗口：发送方根据网络反馈控制在途数据。
- MSS：单个 TCP Segment 的最大载荷，通常基于接口 MTU。

查看连接内部指标：

```bash
ss -ti
nstat -az | grep -E 'TcpRetransSegs|TcpExtTCPTimeouts'
```

重传是结果，不是根因。链路丢包、拥塞、MTU、接收端过载和乱序都可能造成重传。

### 4.3 关闭与 TIME_WAIT {/* #关闭与-timewait */}

TCP 是全双工连接，两个方向需要分别关闭。主动关闭方通常进入 TIME_WAIT，以避免旧
报文污染后续相同四元组连接，并允许重发最后 ACK。

大量 TIME_WAIT 不应直接通过缩短内核参数“优化”。先判断是否存在短连接风暴、
连接池缺失、上游重试或负载均衡行为。

### 4.4 序列号与窗口：把可靠性变成可计算状态

从序列号 1001 发送 1000 字节，覆盖 `[1001, 2001)`，累计 ACK=2001 表示下一期待位置为 2001。中间缺口未补齐时，后面收到的数据不能直接推进累计 ACK；SACK 可另外报告已收到的区间，帮助避免无谓重传。

SYN 和 FIN 各占一个序列号，纯 ACK 不占。TCP ACK 确认传输层接收，不是应用消费。应用读取慢可能使接收窗口 `rwnd` 缩小，网络拥塞主要影响发送方的 `cwnd`。

在简化的非恢复状态下，可新增在途预算约为：

```text
max(0, min(cwnd, rwnd) - 已发送但未确认的字节数)
```

`cwnd=64 KiB`、`rwnd=32 KiB`、在途 24 KiB 时只余约 8 KiB。增大发送缓冲不能突破它。实际还受 pacing、恢复算法和应用供数约束。见 [TCP 拥塞控制](https://www.rfc-editor.org/info/rfc5681/)。

### 4.5 高带宽为什么仍然低吞吐

填满 1 Gbit/s、RTT 40 ms 的路径，约需 `10^9 × 0.04 / 8 = 5,000,000` 字节在途数据，这就是带宽时延积。它用于解释窗口约束，不是要求把全部系统缓冲直接设成 5 MB。

有效窗口只有 1 MiB 时，忽略其他瓶颈的稳态上限约为 `1 MiB × 8 / 0.04 ≈ 210 Mbit/s`。短请求还受握手和窗口增长影响，未必进入稳态。

RTO（重传超时）根据 RTT 估计与波动计算，不是固定“每隔三秒重传”；连续超时会退避。ACK/SACK 的丢失线索还可触发更早恢复，但重复 ACK 也可能来自乱序，不能凭一个重复 ACK 判定丢包。见 [RTO 算法](https://www.rfc-editor.org/info/rfc6298/)。

### 4.6 连接已建立，不等于应用已接收

Linux 监听端还需区分等待握手完成的请求状态与等待应用 `accept` 的已完成连接队列；SYN cookies 等机制会改变具体路径。客户端 `connect` 成功时，服务端应用可能尚未 accept，也未必有工作线程处理请求。

收到 FIN 表示对端该方向不会再发送新字节，本端仍可向另一方向发送，称为半关闭。持续 `CLOSE_WAIT` 应检查应用处理 EOF 和关闭资源的行为；`TIME_WAIT` 通常是主动关闭后的协议保护。两者不能统一当成垃圾连接。见 [TCP 状态机](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.3.2) 与 [listen](https://man7.org/linux/man-pages/man2/listen.2.html)。

## 5. DNS 是访问链路的一部分

典型解析：

```text
应用
→ libc / 本地缓存
→ 递归解析器
→ 根、顶级域、权威服务器
→ 缓存结果
```

排查命令：

```bash
getent hosts example.com
dig example.com A
dig example.com AAAA
dig +trace example.com
resolvectl status
```

必须区分：

- 应用实际使用的解析库与 `dig` 是否相同。
- A 与 AAAA 是否都正常。
- 搜索域、`ndots` 和超时重试是否放大延迟。
- 权威记录正确但递归缓存是否仍持有旧 TTL。
- DNS 返回地址后，后续 TCP/TLS/HTTP 是否成功。

递归与权威的分工、委派与 Glue、TTL 与负缓存，以及 DNSSEC、DoT/DoH 的差异，
可继续阅读 [DNS 原理系列](../services/dns/00-DNS学习路线.md)。

## 6. 最小连接实验

服务端：

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

另一个终端：

```bash
ss -lntp 'sport = :8080'
curl -v --connect-timeout 2 http://127.0.0.1:8080/
tcpdump -ni lo 'tcp port 8080'
```

观察握手、HTTP 数据和关闭。然后访问未监听端口：

```bash
curl -v --connect-timeout 2 http://127.0.0.1:8081/
```

本机通常返回 RST，因此表现为“Connection refused”；如果防火墙静默丢弃，表现更像
连接超时。这两种现象的排障方向不同。

## 7. 连接诊断决策表

| 阶段 | 检查 | 工具 |
| --- | --- | --- |
| 名称解析 | 域名得到哪些 A/AAAA 地址 | `getent`、`dig` |
| 路由 | 实际源地址、下一跳和接口 | `ip route get` |
| 邻居 | 下一跳 MAC 是否解析 | `ip neigh` |
| 监听 | 端口绑定在哪个地址 | `ss -lntup` |
| 策略 | 主机和中间设备是否允许 | `nft`、ACL 日志 |
| TCP | SYN、SYN-ACK、RST、重传 | `tcpdump`、`ss -ti` |
| TLS | SNI、证书、协议版本 | `openssl s_client` |
| HTTP | 状态码、Header、代理链 | `curl -v` |
| 业务 | 错误率、延迟、依赖服务 | 指标、日志、Trace |

## 8. 常见误区

- `telnet` 能连端口就证明业务正常：它最多证明 TCP 握手。
- 丢包一定发生在网络：应用和内核队列也会丢弃。
- UDP 没有连接所以防火墙不维护状态：状态防火墙仍可维护伪会话。
- DNS TTL 到期后所有客户端立即更新：本地、递归、应用和代理可能各有缓存。
- 调大所有缓冲区能消除延迟：过大队列会产生 Bufferbloat。

### 8.1 思考与解答 {/* #思考与解答 */}

**ACK=2001 表示应用处理了 2000 字节吗？**

不能。它是序列空间的下一期待位置，需结合初始序列号解释，也不能推出应用处理进度。

**接收窗口为零，要先增加链路带宽吗？**

不应。先检查接收端消费、缓冲与资源压力。零窗口是流量控制信号，不是链路容量不足的直接证明。

**UDP 显示 ESTAB，为什么仍丢请求？**

该状态可能只是 Socket 关联对端或连接跟踪已见双向报文，并未为 UDP 增加可靠交付保证。

**握手快但业务响应慢，问题在哪？**

分别计量解析、建连、TLS 和应用响应，再检查 accept/工作队列、窗口、重传、PMTU 和下游调用。握手只验证了少量报文的交互。

## 9. 参考资料

- [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293)
- [RFC 768: User Datagram Protocol](https://www.rfc-editor.org/rfc/rfc768)
- [RFC 792: Internet Control Message Protocol](https://www.rfc-editor.org/rfc/rfc792)
- [RFC 1034: Domain Names—Concepts and Facilities](https://www.rfc-editor.org/rfc/rfc1034)

[下一篇：OSPF、ECMP 与 BFD →](../routing-switching/06-OSPF-ECMP与BFD.md)
