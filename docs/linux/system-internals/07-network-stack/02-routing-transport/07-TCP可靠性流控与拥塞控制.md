---
title: "TCP 可靠性、流量控制与拥塞控制：窗口、ACK、重传和带宽时延积"
sidebar_label: "07. TCP 可靠性、流控与拥塞控制"
sidebar_position: 7
description: "解释序列号、累计 ACK、SACK、RTO、重传、接收窗口、拥塞窗口、RTT 和带宽时延积。"
tags: [Linux, TCP, Retransmission, Congestion Control, RTT]
---

# TCP 可靠性、流量控制与拥塞控制：窗口、ACK、重传和带宽时延积

TCP 同时解决三件不同的事：用序列号和重传实现可靠有序字节流，用接收窗口保护接收端，用拥塞窗口控制对网络的注入速率。

## 1. 发送上限

简化理解：

```text
允许在途数据 ≈ min(rwnd, cwnd)
```

- `rwnd`：接收端通告的可用接收空间，属于流量控制。
- `cwnd`：发送端根据网络反馈维护的拥塞窗口。

Socket send buffer 还保存待发送和待确认数据，但不能直接等同 cwnd。

## 2. ACK 与序列号

TCP 序列号按字节编号，ACK 通常累计确认某序号之前的连续字节。收到 ACK 只说明对端 TCP 栈确认，不说明对端应用已读取、写盘或提交事务。

SACK 允许接收端报告不连续到达的块，发送端更精确重传缺口，避免把已收到数据全部重传。

## 3. 重传触发

- RTO 超时：在估算超时内未收到确认。
- 快速重传/现代丢失检测：根据重复 ACK/SACK 和时间信息推断丢包。
- SYN/FIN 也有各自重传和超时。

重传可能来自实际丢包、严重乱序、ACK 丢失、设备/队列丢弃或路径切换。单看 RetransSegs 无法定位哪一跳。

## 4. RTT 与 RTO

RTT 是往返时间样本；RTO 需要平滑 RTT 和波动估算，并设上下界。偶发抖动会影响 RTO 和发送节奏。应用超时若小于网络/重传合理时间，可能在 TCP 仍恢复时提前放弃。

## 5. 带宽时延积

```text
BDP = 链路带宽 × RTT
```

要填满高带宽高 RTT 链路，需要足够在途数据和窗口。例如 100Gbps、RTT 10ms 的理论 BDP 约 125MB。窗口扩大、缓冲和拥塞算法都会影响能否达到吞吐。

调大缓冲不能修复丢包、单流 CPU、应用供数不足和对端限速，过大缓冲还可能增加排队延迟。

## 6. 拥塞控制

Linux 支持多种算法，如 CUBIC、BBR（可用情况依内核/发行版）。算法根据 ACK、丢包、RTT 或带宽模型调整 cwnd。更换算法会改变共享公平性和网络行为，应在目标路径、RTT、丢包和交换机队列条件下验证。

```bash
sysctl net.ipv4.tcp_congestion_control
sysctl net.ipv4.tcp_available_congestion_control
ss -ti dst <peer>
```

`ss -ti` 可展示 cwnd、rtt、retrans、delivery rate 等，字段依内核版本和连接状态变化。

## 7. 零窗口

应用读取慢导致接收缓冲占满，接收端可通告零窗口，发送端停止正常发送并周期探测。这是接收端背压，不等同网络丢包。抓包中的 Window Full/Zero Window 要结合应用消费速度和 Socket 内存。

## 8. 练习与答案

**问题：抓到 TCP ACK 是否证明数据库已提交？**

答案：不能。ACK 只确认对端 TCP 接收了字节；数据库执行、WAL 持久化和副本确认需要应用协议响应。

**问题：带宽 100Gbps 但单流只有 20Gbps，是否一定是网卡故障？**

答案：不是。窗口/BDP、RTT、拥塞控制、单流队列/CPU、应用供数、丢包和对端限制都可能成为瓶颈。

下一篇：[UDP、分片与 ICMP 错误](./08-UDP分片与ICMP错误.md)
