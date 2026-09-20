---
title: "网络队列与 Backlog：包究竟在哪一层等待或被丢弃"
sidebar_label: "10. 网络队列与 Backlog"
sidebar_position: 10
description: "梳理 NIC Ring、NAPI/softnet、qdisc、Socket、SYN/accept 和应用队列的容量与丢包证据。"
tags: [Linux, Backlog, NIC Ring, Socket Queue, Packet Drop]
---

# 网络队列与 Backlog：包究竟在哪一层等待或被丢弃

“网络队列满”不是一个明确结论。主机内至少有硬件 Ring、softnet backlog、qdisc、Socket 缓冲、监听队列和应用队列，每层单位、容量、背压和丢弃计数都不同。

## 1. 接收方向队列

```text
NIC RX Ring
→ NAPI poll / per-CPU backlog
→ 协议栈
→ TCP/UDP receive queue
→ epoll/线程调度
→ 应用内部队列
```

- RX Ring 满：NIC 无空 descriptor，可能硬件丢包。
- softnet 处理不过来：per-CPU backlog/drop/time squeeze。
- UDP receive buffer 满：数据报丢弃。
- TCP receive buffer 满：窗口收缩/零窗口，形成背压。
- 应用队列满：协议栈可能健康，但业务拒绝或排队。

## 2. 发送方向队列

```text
应用发送队列
→ Socket send/retransmission queue
→ qdisc backlog
→ 驱动 TX Ring
→ NIC/链路
```

TCP 对端窗口或拥塞窗口限制时，数据可能长期留在 Socket；流量整形时在 qdisc 排队；TX Ring 满时驱动停止子队列等待 completion。

## 3. 监听队列

SYN backlog 和 accept queue 是连接建立路径，不等同 Socket 数据收发缓冲。应用线程耗尽、GC 或阻塞可让 accept queue 满，即使 CPU 和网络链路看似正常。

## 4. 观察矩阵

| 层 | 工具/指标 |
|---|---|
| NIC Ring | `ethtool -g/-S`、驱动统计 |
| IRQ/NAPI | `/proc/interrupts`、`/proc/softirqs`、`softnet_stat` |
| qdisc | `tc -s qdisc` |
| Socket | `ss -m -i`、sockstat、SNMP |
| listen | `ss -lnt`、ListenOverflows/ListenDrops |
| 应用 | 请求队列、线程池、事件循环延迟 |

## 5. 缓冲越大越好吗

更大缓冲能吸收短时突发，但持续过载下只会增加排队时延和内存，并让故障更晚暴露。正确设计包含：

- 峰值与稳态容量。
- 明确最大排队时间。
- 过载时的丢弃/背压/限流策略。
- 与上游重试预算协同。
- 队列深度和时延联合监控。

## 6. 微突发

一秒平均流量很低，不代表微秒/毫秒级没有突发打满 Ring 或交换机缓冲。低频监控看不到短暂丢包，需要硬件计数、细粒度采样或流量重放验证。

## 7. 练习与答案

**问题：把所有网络缓冲扩大十倍能否消除丢包？**

答案：只能吸收更大短时突发；持续输入大于处理能力时仍会满，并增加内存和排队延迟。

**问题：ListenDrops 增长是否说明网卡 RX Ring 满？**

答案：不说明。它更接近监听连接处理阶段；网卡 Ring 是更早的驱动/硬件层，需要独立计数器。

下一篇：[qdisc 与流量控制](./11-qdisc与流量控制.md)
