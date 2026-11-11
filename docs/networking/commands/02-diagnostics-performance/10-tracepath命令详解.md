---
title: "tracepath 命令详解：无特权路径追踪与 Path MTU 发现"
sidebar_label: "10. tracepath 命令详解：无特权路径追踪与 Path MTU 发现"
sidebar_position: 10
description: "完整讲解 iputils tracepath 的全部参数、Linux error queue、TTL、Path MTU、asymm 输出、错误码、与 traceroute 的差异及 PMTU 黑洞排障。"
tags: [Linux, tracepath, iputils, traceroute, PMTU, 网络排障]
---

# tracepath 命令详解：无特权路径追踪与 Path MTU 发现

`tracepath` 使用 UDP 探测、逐步增加 TTL，并通过 Linux Socket error queue 接收 ICMP 错误。它的特点是普通用户可运行、参数少，而且会在路径中 MTU 发生变化时显示 `pmtu`。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | iputils 20250605 |
| 主要用途 | 路径 hop 发现 + Path MTU 变化观察 |
| 默认协议 | UDP，目的端口为随机或实现选择的端口 |
| 默认最大 hop | 30 |
| 安全级别 | `[R]` 诊断；仍会产生逐 hop UDP 探测流量 |
| 权限 | 通常不需要 root/capability |

```bash
tracepath -V
tracepath -n example.com
```

## 2. 完整语法与全部参数

```text
tracepath [-4] [-6] [-n] [-b] [-l PKTLEN]
          [-m MAX_HOPS] [-p PORT] [-V] DESTINATION
```

| 参数 | 作用 |
|---|---|
| `-4` | 只使用 IPv4 |
| `-6` | 只使用 IPv6 |
| `-n` | 主要打印数字 IP，不做普通名称解析 |
| `-b` | 同时打印名称和 IP |
| `-l PKTLEN` | 设置初始完整探测包长度；默认 IPv4 65535、IPv6 128000 |
| `-m MAX_HOPS` | 最大 hop/TTL，默认 30 |
| `-p PORT` | 初始 UDP 目的端口 |
| `-V` | 版本并退出 |

`tracepath` 故意没有 traceroute 的 TCP/ICMP 方法、并行探测、每 hop query 数等高级参数。

## 3. 工作原理

```text
TTL=1 UDP probe → 第 1 跳 TTL Exceeded
TTL=2 UDP probe → 第 2 跳 TTL Exceeded
...
目标 UDP 端口不可达 → ICMP Port Unreachable → reached

中途报文过大 → ICMP Fragmentation Needed / Packet Too Big → pmtu N
```

IPv4 传统 ICMP 错误返回的信息可能不足，tracepath 会通过变化 UDP port 等方法维护 probe 历史。IPv6 的错误信息模型更适合这一机制。

## 4. 读懂输出

```text
 1?: [LOCALHOST]                      pmtu 1500
 1:  192.0.2.1                         0.421ms
 2:  198.51.100.1                      1.843ms pmtu 1480
 8:  203.0.113.10                     12.520ms reached
     Resume: pmtu 1480 hops 8 back 8
```

| 输出 | 含义 |
|---|---|
| `N:` | 推断/确认的正向 TTL hop |
| `N?:` | 错误信息不足，hop 数为猜测 |
| `[LOCALHOST]` | 错误在本地生成，探测未发出或受本地 PMTU 限制 |
| `pmtu N` | 该处发现新的 Path MTU |
| `asymm N` | 根据返回 TTL 猜测的反向 hop 数不同；结果不可靠 |
| `reached` | 收到目标的 Port Unreachable 等，说明探测到达目标网络栈 |
| `Resume` | 最终 PMTU、正向 hops 与猜测反向 hops 汇总 |

`reached` 不代表目标 UDP 端口开放；恰恰常由目标返回 Port Unreachable 终止追踪。

## 5. 错误标记

| 输出 | 内核错误 | 含义 |
|---|---|---|
| `!A` | `EACCES` | 管理策略禁止 |
| `!H` | `EHOSTUNREACH` | 主机不可达 |
| `!N` | `ENETUNREACH` | 网络不可达 |
| `!P` | `EPROTO` | 协议不可达 |
| `pmtu N` | `EMSGSIZE` | 包过大，得到新 MTU |
| `reached` | `ECONNREFUSED` | 目标端口拒绝，路径已到达 |
| timeout | `ETIMEDOUT` | 未收到响应 |
| `NET ERROR N` | 其他 | 其他 errno |

防火墙可能丢弃探测或 ICMP 错误，导致 `no reply`。这只能说明观测不到响应，不能证明转发 hop 故障。

## 6. PMTU 排障

```bash
tracepath -4 -n 203.0.113.10
tracepath -6 -n 2001:db8::10
tracepath -n -l 9000 203.0.113.10
```

判断顺序：

1. `ip route get DEST` 看本机出接口与路由 MTU。
2. `ip link show` 看设备 MTU。
3. `tracepath` 看路径是否把 pmtu 从 9000/1500 降低。
4. `ping -M do -s ...` 验证特定 payload。
5. `tcpdump 'icmp or icmp6'` 看 Packet Too Big/Fragmentation Needed 是否回来。
6. 检查隧道、VPN、VXLAN、IPsec 和防火墙是否吞掉 ICMP。

如果小请求成功、大响应/大流量卡住，而 tracepath/ping 显示 PMTU 异常，应优先怀疑 PMTU 黑洞，不要直接把 TCP MSS 调小当作根因修复。

## 7. 指定端口

```bash
tracepath -n -p 33434 203.0.113.10
```

更换端口可以绕开某些端口策略，但它仍是 UDP，不能模拟 TCP 443 的防火墙、ECMP hash 和应用响应。需要 TCP 路径时使用 `traceroute -T -p 443` 或 `mtr -T -P 443`。

## 8. 与其他工具的选择

| 工具 | 优势 | 局限 |
|---|---|---|
| `tracepath` | 无特权、自动显示 Path MTU、参数简单 | 仅 UDP 方法，控制能力少 |
| `traceroute` | UDP/ICMP/TCP、多种 TTL/query/等待参数 | 输出是一组有限快照 |
| `mtr` | 持续统计每 hop loss/latency | 容易误读 ICMP 限速，探测流量更多 |
| `ping` | 端到端 RTT 与简单 PMTU 验证 | 不显示路径 |

## 9. 自动化与安全

```bash
timeout 20s tracepath -n -m 20 203.0.113.10
```

`tracepath` 没有结构化 JSON 和每 hop 固定 query count。自动化报告应保存版本、源节点/namespace、目标解析结果和原始文本，并用外层 timeout 限制执行时间。

## 10. 易错点

- `-l` 是完整初始 packet length，不等于 `ping -s` 的 payload。
- `asymm` 是基于返回 TTL 的猜测，不是精确反向路由。
- 某 hop `no reply` 但后续 hop/目标可达，通常表示该路由器不回或限速 ICMP。
- 路径可随 ECMP、时间和五元组变化，一次追踪不是永久拓扑。
- UDP tracepath 路径未必与 TCP/RDMA 业务路径相同。

## 11. 资料

- [iputils tracepath(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/tracepath.8.html)
- [iputils 官方仓库](https://github.com/iputils/iputils)

本文针对 iputils tracepath；其他系统的同名工具可能不同。
