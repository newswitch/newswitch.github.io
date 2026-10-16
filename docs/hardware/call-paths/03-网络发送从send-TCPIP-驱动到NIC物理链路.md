---
title: "一次网络发送从 send、TCP/IP、驱动到 NIC 和物理链路"
sidebar_label: "03. send 到 NIC 与物理链路"
sidebar_position: 3
description: "追踪 send 系统调用经过 Socket、TCP/IP、qdisc、Netdevice、TX Ring、DMA、NIC Offload、MAC 与 PHY 的发送路径。"
tags: [send, TCP, qdisc, Netdevice, TX Ring, NIC]
---

# 一次网络发送从 send、TCP/IP、驱动到 NIC 和物理链路

TCP `send()` 成功通常表示数据已被 Kernel 接受，不表示报文已经离开网卡，也不表示对端应用已经读取。理解返回语义是网络性能和可靠性分析的起点。

## 1. 用户态入口

```c
ssize_t n = send(fd, buffer, length, flags);
```

典型路径：

```text
libc
→ System Call
→ Socket File
→ Protocol Operations
→ TCP/UDP
→ IP
→ qdisc / Traffic Control
→ Netdevice TX Queue
→ Driver
→ NIC
```

Socket fd 指向 Kernel Socket 对象。TCP 和 UDP 的排队、拥塞与完成语义不同。

## 2. User Buffer 到 Socket Buffer

普通 `send()` 通常把用户数据复制或组织进 Kernel 管理的发送缓冲。Kernel 需要保证系统调用返回后，应用即使修改原 Buffer 也不破坏已经接受的数据。

Zero-copy 接口可以减少复制，但会增加页面 Pin、Completion 和 Buffer 生命周期约束，不能简单等同于“完全无 CPU 开销”。

## 3. TCP 发送状态

TCP 需要：

- 按 Sequence Number 管理 Byte Stream；
- 根据 MSS 分段；
- 维护 Send Window 与 Receive Window；
- 执行拥塞控制和 Pacing；
- 处理重传、SACK 和 RTT；
- 在 ACK 到达前保留必要数据。

应用写入速度超过网络确认速度时，Socket Send Buffer 会增长并最终产生 Backpressure。

## 4. 路由与邻居

IP 层决定：

- 目标地址与路由；
- 出口 Netdevice；
- Source Address；
- MTU 和分片/PMTU 行为；
- Next Hop。

以太网发送还需要邻居项把 Next-Hop IP 映射为 MAC。邻居未解析时，报文可能排队并触发 ARP/ND，而不是立即进入网卡。

## 5. qdisc 与流量控制

qdisc 位于进入驱动前的排队/调度位置，可执行：

- FIFO、FQ、Pacing；
- Shaping；
- Classification；
- Drop/ECN；
- 多队列选择。

qdisc 排队高会增加延迟，但直接绕过所有排队也可能失去公平、Pacing 和拥塞控制配合。

## 6. SKB 与 Offload

Kernel 常用 `sk_buff` 描述报文和分片。启用 TSO/GSO 时，一个较大的 SKB 可以代表多个线速报文：

```text
Large SKB
→ Driver/NIC 获得 MSS 与 Header 信息
→ NIC 分割成多个 Ethernet Frame
→ 分别计算校验和并发送
```

因此主机发送点抓包可能看到大于 MTU 的 Packet，这不等于线上真的出现超大帧。

## 7. Driver 与 TX Ring

```text
选择 TX Queue
→ DMA Map SKB Data/Fragments
→ 填写 TX Descriptor
→ 更新 Ring Tail
→ 写 MMIO Doorbell
→ NIC DMA 读取 Descriptor 和报文
```

CPU 负责构造和提交描述符，NIC 通过 DMA 读取 Host Memory 中的数据。TX Ring 满时，Driver 会停止对应 Queue，Completion 回收后再唤醒。

## 8. NIC 到物理链路

NIC 后续可执行：

```text
Parser / Offload
→ Segmentation / Checksum
→ Packet Buffer
→ MAC Frame / FCS
→ PCS / FEC
→ PMA / SerDes
→ Cable / Optics
```

网卡统计中的 TX Complete 常表示 Descriptor/Buffer 可以回收，不表示远端 TCP ACK 已到达。

## 9. TX Completion 与 TCP ACK

需要区分三种完成：

1. `send()` 返回：Kernel 接受了多少数据；
2. NIC TX Completion：网卡完成本地发送，Buffer 可回收；
3. TCP ACK：对端 TCP Stack 确认字节到达；
4. 应用层响应：对端应用实际处理并返回结果。

前一层成功不保证后一层完成。UDP 更没有 TCP ACK 语义。

## 10. 阻塞发生在哪里

- Socket Send Buffer 满：应用 `send()` 阻塞或返回 `EAGAIN`；
- TCP Window/拥塞窗口受限：数据留在 TCP Queue；
- qdisc 堆积：进入驱动前等待；
- TX Ring 满：Netdevice Queue 被 Stop；
- NIC/PCIe/FEC 异常：完成变慢或错误增长；
- 物理/网络拥塞：丢包、ECN、RTT、重传上升。

## 11. 观测方法

```bash
ss -tin
tc -s qdisc show dev eth0
ip -s link show dev eth0
ethtool -S eth0
ethtool -k eth0
cat /proc/interrupts
```

抓包点、Offload 和 Namespace 会改变看到的报文形态。必须标明在应用、主机出口、交换机还是对端抓包。

## 12. 练习与答案

**问题：阻塞 TCP `send()` 返回成功，能否立即释放业务层唯一副本？**

答案：从系统调用约定看，Kernel 已接受返回字节，应用可以复用其输入 Buffer；但若业务要求对端持久化，还必须等待应用层确认，不能把 `send()` 返回当作远端完成。

**问题：TX Ring 满是否一定表示物理链路打满？**

答案：不一定。也可能是 Completion 处理不及时、IRQ/CPU 问题、PCIe 异常、Driver/NIC Reset 或特定 Queue 热点。

延伸阅读：[发送路径：send 到 NIC TX](../../linux/system-internals/07-network-stack/01-packet-path/02-发送路径-send到NIC-TX.md)。
