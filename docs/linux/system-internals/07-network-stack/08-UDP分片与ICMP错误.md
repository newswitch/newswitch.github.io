---
title: "UDP、IP 分片与 ICMP 错误：无连接数据报的真实边界"
sidebar_label: "08. UDP、分片与 ICMP 错误"
sidebar_position: 8
description: "解释 UDP 数据报边界、校验和、Socket 队列、IP 分片、PMTU、ICMP 错误和应用可靠性设计。"
tags: [Linux, UDP, IP Fragmentation, PMTU, ICMP]
---

# UDP、IP 分片与 ICMP 错误：无连接数据报的真实边界

UDP 提供端口复用和数据报边界，但不保证送达、顺序、去重、流控和拥塞控制。应用若需要这些能力，必须在协议层实现或选用其他传输协议。

## 1. 数据报语义

一次 UDP send 通常对应一个 UDP 数据报。接收缓冲太小，数据报可能被截断并丢弃剩余部分；它不会像 TCP 字节流那样让下次 recv 继续读取同一个报文尾部。

UDP send 成功表示本机接受数据，不保证对端端口存在或报文送达。

## 2. 无连接不等于无状态

UDP Socket 可以 `connect()` 固定默认对端，使内核进行路由缓存和错误关联，但不会产生 TCP 握手和可靠状态。Netfilter conntrack、NAT 和负载均衡器也会为 UDP 流维护有超时的状态表。

## 3. 缓冲区满时

应用消费速度低于到达速率时，UDP 接收队列满后数据报被丢弃，发送端通常无法从 UDP 本身得知。观察：

```bash
ss -u -a -m
netstat -su
cat /proc/net/snmp | grep -A1 '^Udp:'
```

`RcvbufErrors`、`InErrors` 增长可提示本机 UDP 接收丢弃，但还要区分网卡、软中断和网络路径更早丢包。

## 4. IP 分片

IPv4 数据报大于路径 MTU 时，在允许条件下可能分片；任一分片丢失会使整份原始数据报无法重组。分片增加状态、内存和攻击面，高性能协议通常尽量避免依赖 IP 分片。

IPv6 中间路由器不执行传统分片，源端根据 PMTU 等机制控制大小。

## 5. PMTU 黑洞

发送端使用 DF/IPv6，路径某处 MTU 更小，需要 ICMP Packet Too Big/Fragmentation Needed 通知。如果 ICMP 被错误过滤，发送端无法学习较小 PMTU，大包反复失败，小包却正常，形成 PMTU 黑洞。

```bash
tracepath <destination>
ping -M do -s <payload> <destination>   # IPv4，参数能力依实现
```

ICMP 是 IP 控制机制的一部分，不能一概全部封禁。

## 6. ICMP Port Unreachable

目的主机 UDP 端口未监听时，可能返回 ICMP Port Unreachable。未连接 UDP Socket 的错误报告时机和 API 行为可能不同；防火墙也可能静默丢弃，使发送方只看到应用超时。

## 7. 应用可靠性

基于 UDP 的可靠协议需要考虑：消息 ID、ACK、重传、顺序、去重、拥塞控制、MTU、超时和放大攻击。QUIC 在 UDP 之上实现连接、可靠流、拥塞控制和加密，并不表示“UDP 自己变可靠”。

## 8. 练习与答案

**问题：UDP send 返回成功，为何服务端完全没有日志？**

答案：报文可能在路由、防火墙、MTU、网卡、软中断、Socket 缓冲或无监听端口处丢失；UDP 不提供端到端送达确认。

**问题：默认 ping 小包正常能否排除 MTU 问题？**

答案：不能。PMTU 黑洞常表现为小包正常、大包失败，需要使用禁止分片的不同大小探测并结合 ICMP 抓包。

下一篇：[Netfilter、Conntrack 与 NAT](./09-Netfilter-Conntrack与NAT.md)
