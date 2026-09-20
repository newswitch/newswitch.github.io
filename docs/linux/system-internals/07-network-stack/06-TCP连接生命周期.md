---
title: "TCP 连接生命周期：握手、监听队列、关闭与 TIMEWAIT"
sidebar_label: "06. TCP 连接生命周期"
sidebar_position: 6
description: "从 SYN、listen/accept 队列、状态机、主动/被动关闭、RST、TIME_WAIT 和端口复用理解连接生命周期。"
tags: [Linux, TCP, Handshake, TIME_WAIT, Listen Queue]
---

# TCP 连接生命周期：握手、监听队列、关闭与 TIMEWAIT

TCP 连接不仅是五元组，还包含序列空间、窗口、拥塞状态、定时器和收发队列。服务“端口在监听”只证明存在 LISTEN Socket，不证明握手队列、accept 队列和应用处理都健康。

## 1. 三次握手

```text
Client                                 Server
SYN, seq=x ---------------------------> LISTEN
             <---------------- SYN+ACK, seq=y, ack=x+1
ACK, ack=y+1 -------------------------> ESTABLISHED
```

握手协商初始序列号及 MSS、窗口扩大、SACK、时间戳等选项。它验证双向基本路径，但不验证应用认证和业务依赖。

## 2. 两类监听队列

概念上服务端维护：

- SYN backlog：尚未完成握手的请求状态。
- Accept queue：握手完成、等待应用 `accept()` 的连接。

具体数据结构和 SYN Cookie 会改变实现。应用 accept 太慢时，完成握手的连接可能积压；SYN 洪水或丢包则影响半连接状态。

```bash
ss -lntp
ss -nt state syn-recv
netstat -s | grep -i -E 'listen|SYN'
```

`listen(backlog)` 参数还会受内核上限和协议实现影响，不能把一个数字当绝对队列容量。

## 3. TCP 状态机

常见状态：

```text
CLOSED → SYN-SENT → ESTABLISHED
LISTEN → SYN-RECV → ESTABLISHED
ESTABLISHED → FIN-WAIT-1/2 → TIME-WAIT → CLOSED
ESTABLISHED → CLOSE-WAIT → LAST-ACK → CLOSED
```

状态名称描述本端看到的协议阶段。大量 CLOSE_WAIT 通常表示对端已关闭，而本地应用尚未 close；大量 TIME_WAIT 通常来自本端主动关闭，未必是故障。

## 4. 四次关闭与半关闭

TCP 两个方向独立关闭。`shutdown(SHUT_WR)` 可发送 FIN 停止本端发送，但仍接收对端数据。应用层协议若没有明确结束语义，双方可能互相等待。

RST 表示异常终止或不存在有效连接状态，未读数据、端口无监听、防火墙策略等都可能触发，必须看两端抓包和 Socket 错误。

## 5. TIME_WAIT 的作用

主动关闭方进入 TIME_WAIT，主要用于：

- 确保最后 ACK 丢失时可重发。
- 让旧连接延迟报文在网络中过期，避免污染同一四元组的新连接。

大量短连接会产生许多 TIME_WAIT，但优化方向通常是连接复用、长连接池和合理负载均衡，而不是盲目缩短协议保护时间。

## 6. 端口和四元组

客户端临时端口可用范围有限，同一源地址到同一目的组合的并发/重建受四元组和状态影响。NAT 会让大量客户端共享出口地址，进一步集中端口资源。

```bash
sysctl net.ipv4.ip_local_port_range
ss -s
ss -tan | awk 'NR>1 {s[$1]++} END {for(k in s) print k,s[k]}'
```

## 7. 练习与答案

**问题：SYN 握手完成后，应用是否已经 accept？**

答案：不一定。连接可在 accept queue 等待应用取走，握手完成与应用获得 fd 是两个时点。

**问题：大量 TIME_WAIT 是否说明服务端未 close？**

答案：通常相反，TIME_WAIT 多出现在主动关闭方；应结合连接方向、短连接模式和四元组观察。

下一篇：[TCP 可靠性、流控与拥塞控制](./07-TCP可靠性流控与拥塞控制.md)
