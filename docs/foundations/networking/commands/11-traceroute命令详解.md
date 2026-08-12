---
title: traceroute 命令详解：UDP、ICMP、TCP 路径追踪与 ECMP 分析
sidebar_position: 11
description: 以 Traceroute for Linux 2.1.6 为基线，讲解 traceroute 全部主要参数、探测方法、TTL、等待策略、并发、端口、MTU、ICMP 扩展和多路径误判。
tags: [Linux, traceroute, ICMP, TCP, UDP, ECMP, 网络排障]
---

# `traceroute` 命令详解：UDP、ICMP、TCP 路径追踪与 ECMP 分析

`traceroute` 发送 TTL/Hop Limit 逐步增加的探测包，让中间路由器返回 ICMP Time Exceeded，从而观察一条探测流量看到的 hop。Linux 实现能使用 UDP、ICMP Echo、TCP SYN、UDPLite、DCCP、SCTP 或 raw protocol，适合按业务协议和端口验证路径策略。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现基线 | Traceroute for Linux 2.1.6 |
| 默认方法 | UDP datagram，使用递增的高位目的端口 |
| 默认 query | 每 hop 3 次 |
| 默认最大 TTL | 30 |
| 安全级别 | `[R]` 路径诊断；大量并发、短等待、多个目标会产生明显探测流量 |
| 权限 | 方法和发行版 capability 配置不同；TCP/ICMP/raw 可能需要额外权限 |

```bash
traceroute --version
traceroute --help
```

## 2. 工作原理和终止条件

```text
TTL=1 → 第 1 跳丢弃并回 ICMP Time Exceeded
TTL=2 → 第 2 跳回 ICMP Time Exceeded
...
UDP 默认方法 → 目标回 ICMP Port Unreachable
ICMP 方法     → 目标回 Echo Reply
TCP SYN 方法  → 目标回 SYN/ACK 或 RST
```

目标返回 RST 也能证明 TCP probe 到达目标网络栈，不等于应用健康；SYN/ACK 只证明该连接尝试获得响应，还要正常关闭/由工具处理。

## 3. 基础参数

| 参数 | 作用 |
|---|---|
| `-4` / `-6` | 强制 IPv4 / IPv6；2.1.6 未显式指定时由 `getaddrinfo()` 选择 |
| `-n` | 数字地址，不反向解析 |
| `-m MAX_TTL` | 最大 hop，默认 30 |
| `-f FIRST_TTL` | 从指定 TTL 开始，跳过前面探测 |
| `-q NQUERIES` | 每 hop probe 数，默认 3 |
| `-N SQUERIES` | 同时在途的 probe 数；过大会增加流量并使输出更难对应 |
| `-w MAX[,HERE,NEAR]` | 等待响应策略，支持按 RTT 自适应的多值形式 |
| `-z SENDWAIT` | probe 间最小等待；大于 10 按毫秒、小于等于 10 按秒的版本语义需看手册 |
| `-V` | 版本 |
| `HOST [PACKET_LEN]` | 目标以及可选完整 probe 长度 |

生产模板：

```bash
traceroute -n -q 3 -m 20 -w 2 203.0.113.10
```

## 4. 探测方法

| 参数/方法 | 报文 | 典型用途 |
|---|---|---|
| 默认 | UDP 高端口 | 通用路径快照 |
| `-I` / `--icmp` | ICMP Echo | 对比 ping 路径 |
| `-T` / `--tcp` | TCP SYN | 模拟常见业务端口策略 |
| `-U` / `--udp` | UDP 到固定目的端口 | DNS、QUIC 等 UDP 端口路径 |
| `-UL` / `--udplite` | UDPLite | 特殊协议诊断 |
| `-D` / `--dccp` | DCCP Request | 特殊协议诊断 |
| `-P PROTO` / `--protocol=PROTO` | raw IP protocol | 高级协议测试 |
| `-M METHOD` | 显式方法名 | 例如 `default`、`icmp`、`tcp`、`udp` 等 |
| `-O OPTION` | 方法专属参数 | 可重复；用 `traceroute --help`/手册查具体方法 |

例子：

```bash
traceroute -n -I 203.0.113.10
sudo traceroute -n -T -p 443 203.0.113.10
traceroute -n -U -p 53 192.0.2.53
```

业务是 TCP 443 时，TCP SYN 更可能通过只允许业务端口的 ACL，并可能使用更接近业务的 ECMP hash；它仍不包含 TLS、HTTP 和真实连接负载。

## 5. 源、接口、端口与 QoS

| 参数 | 作用 |
|---|---|
| `-i DEVICE` | 指定出接口 |
| `-s SOURCE` | 指定源地址 |
| `--sport=PORT` | 指定源端口 |
| `-p PORT` | 默认 UDP 的起始端口，或所选方法的目标端口 |
| `-t TOS` | IPv4 TOS/DS 字段 |
| `-l FLOW_LABEL` | IPv6 flow label |
| `-r` | 绕过普通路由表，面向直连网络 |
| `-g GATEWAY,...` | IPv4 loose source route gateway，现代网络大多禁用/忽略 |

```bash
traceroute -n -i eth1 -s 198.51.100.10 203.0.113.10
sudo traceroute -n -T -p 443 --sport=40000 -t 0xb8 203.0.113.10
```

固定源端口/目的端口能让多次测试更容易落在同一 ECMP flow，但 NAT、设备 hash 字段和路径变化仍可能改变结果。

## 6. IP、MTU 和 ICMP 扩展参数

| 参数 | 作用 |
|---|---|
| `-F` | 设置 Don't Fragment，IPv4 使用 |
| `--mtu` | 沿路径发现 MTU，通常隐含 `-F`，需要合适初始 packet length |
| `-e` | 显示 ICMP extension，包括支持设备返回的 MPLS/interface 信息 |
| `-A` | 对 hop 做 AS path lookup；会产生额外 DNS 查询且结果依赖数据库 |
| `--back` | 猜测返回路径 hop 数并显示差值，不是实际反向 traceroute |

```bash
traceroute -n --mtu 203.0.113.10 9000
traceroute -n -e 203.0.113.10
```

`--mtu` 没看到变化不代表 PMTU 一定正常：ICMP 可能被过滤，设备也可能不返回足够信息。继续用 `tracepath`、`ping -M do` 和抓包验证。

## 7. 读懂输出和 ICMP 标记

```text
 3  198.51.100.1  2.102 ms  2.023 ms  2.010 ms
 4  * * *
 5  203.0.113.10  8.211 ms !X  8.190 ms !X  8.180 ms !X
```

常见标记：

| 标记 | 含义 |
|---|---|
| `*` | 等待时间内没有响应 |
| `!H` | Host unreachable |
| `!N` | Network unreachable |
| `!P` | Protocol unreachable |
| `!X` | Administratively prohibited |
| `!F-N` | Fragmentation needed，并给出 MTU N |
| `!S` | Source route failed |
| `!V` / `!C` | Host precedence violation / precedence cutoff，少见 |
| `!<NUM>` | 其他 ICMP unreachable code |

一个 hop 的三个 IP 不同，可能是 per-packet load balancing；后续路径变化也可能由 ECMP、ICMP 生成地址或控制面切换造成。

## 8. 最重要的误读：中间 hop 丢包

```text
hop 5: * * *
hop 6: 正常
目标: 正常
```

这通常说明 hop 5 不响应或限速 TTL Exceeded，但仍转发流量。只有当从某 hop 开始直到目标都出现一致问题，并且端到端业务/抓包也有证据时，才可能定位为该段路径故障。

## 9. ECMP 与 Paris traceroute 问题

默认 UDP traceroute 通过变化端口区分 probe，这些字段又常参与 ECMP hash，因此一次输出可能把多条路径拼在一起。应：

1. 使用 TCP/UDP 固定业务端口和稳定源端口。
2. 多次采样而不是相信单次。
3. 在网络设备遥测或流日志中验证真实五元组路径。
4. 认识到 NAT 和 per-packet ECMP 仍会改变观察。

## 10. 防火墙场景对比

```bash
traceroute -n 203.0.113.10
traceroute -n -I 203.0.113.10
sudo traceroute -n -T -p 443 203.0.113.10
```

- UDP 失败、TCP 443 成功：可能是路径 ACL 只允许业务协议。
- ICMP 成功、TCP 443 失败：可能是端口/服务/ACL，而不是基础 IP 路由。
- 三者都在同一位置消失：再结合正反向抓包、路由和设备状态。

## 11. 易错点与安全

- `*` 是“没收到 ICMP 响应”，不是“该 hop 丢了业务包”。
- traceroute 只观测正向 probe 与返回 ICMP 的组合，不能直接给出反向真实路径。
- DNS PTR 查询会让输出变慢并混入 DNS 故障，排障先用 `-n`。
- TCP traceroute 到 443 不等于 HTTPS 可用。
- 提高 `-N`、降低 `-z`、增大 `-q` 会显著增加探测流量。
- `traceroute6` 常是同一程序入口，优先显式 `traceroute -6`。

## 12. 资料

- [Traceroute for Linux 2.1.6 发布页](https://sourceforge.net/projects/traceroute/files/traceroute/traceroute-2.1.6/)
- [traceroute(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/traceroute.8.html)

BusyBox、BSD 和其他 traceroute 实现的参数不同，先运行本机 `--version` 与 `--help`。
