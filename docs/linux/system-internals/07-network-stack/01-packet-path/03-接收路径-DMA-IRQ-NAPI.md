---
title: "接收路径：DMA、IRQ、NAPI 与协议栈如何把包送给应用"
sidebar_label: "03. 接收路径：DMA、IRQ 与 NAPI"
sidebar_position: 3
description: "追踪 NIC RX Ring、DMA、MSI-X、NAPI Poll、GRO、L2/IP/TCP、Socket 队列和应用唤醒。"
tags: [Linux, RX Path, DMA, NAPI, SoftIRQ]
---

# 接收路径：DMA、IRQ、NAPI 与协议栈如何把包送给应用

网卡收到帧后不会直接调用目标进程。它先 DMA 到主机内存，驱动通过 NAPI 批量取包，内核完成协议处理并把数据排入 Socket，最后唤醒等待应用。

## 1. 典型接收路径

```text
驱动预先准备 RX descriptors 和 buffers
→ NIC 收到帧并选择 RX queue
→ DMA 写入 buffer、更新 completion
→ MSI-X 中断通知 CPU
→ 驱动屏蔽/节流该队列中断并调度 NAPI
→ NAPI poll 批量回收 RX descriptors
→ 可选 XDP、GRO
→ 构建/提交 skb 到协议栈
→ Ethernet/VLAN/IP/Netfilter/路由
→ TCP/UDP 查找 Socket
→ 放入 Socket receive queue
→ 唤醒 epoll/阻塞 recv 的线程
```

不同驱动、XDP 模式和虚拟设备路径会改变 skb 建立时机。

## 2. 为什么使用 NAPI

低流量时，中断能快速通知；高流量若每包一次中断会形成中断风暴。NAPI 在收到通知后按 budget 轮询一批包：

- 减少每包中断开销。
- 批量处理提高 Cache 局部性。
- 通过 budget 避免一个队列无限占用 CPU。

若本轮未处理完，后续软中断继续调度；压力过高时工作可能落到 `ksoftirqd/N`，并出现 backlog/drop。

## 3. XDP 与 GRO

- XDP 可在很早的驱动接收路径处理包，执行 DROP/PASS/REDIRECT/TX 等动作，常早于普通 skb 协议栈。
- GRO 把可合并的接收包聚合为更大的逻辑单元，减少协议栈每包开销。

早期丢包可能在 tcpdump 常见抓包点之前发生，因此“抓不到包”可能是没到主机，也可能是在更早 hook 被处理。

## 4. 包到 Socket 后仍可能等待

Socket receive queue 有容量，应用读取慢会使接收窗口收缩；UDP 缓冲满可能直接丢数据报。TCP 会通过窗口进行背压，但仍可能受全局 Socket 内存和队列限制。

包进入 receive queue 不等于业务完成。应用线程还要被调度、解析协议、执行逻辑和返回响应。

## 5. 观察 CPU 与队列

```bash
grep -E 'NET_RX|NET_TX' /proc/softirqs
cat /proc/net/softnet_stat
grep -i <interface-or-driver> /proc/interrupts
ethtool -l <interface>
ethtool -S <interface>
ss -m -ti
```

`softnet_stat` 为每 CPU 十六进制字段，字段定义随内核演进，应按目标版本文档/源码解析，不应只复制固定列号脚本。

## 6. 单核热点

RSS hash、队列数、IRQ affinity、RPS/RFS、Flow Director 和应用 SO_REUSEPORT 共同决定流量分布。单个大流通常保持在一个队列/CPU 以维持顺序，因此整机很多核空闲时也可能一个 softirq 核饱和。

## 7. 练习与答案

**问题：网卡 RX packets 增长是否表示应用已 recv？**

答案：不表示。包还要经过 NAPI、协议栈和 Socket 队列，期间可丢弃或等待，应用也可能没有及时调度读取。

**问题：高流量时中断次数没有按包数增长，是不是漏中断？**

答案：不一定。NAPI 和中断合并会让一次通知批量处理多个包，这是正常优化。

下一篇：[sk_buff 生命周期](./04-sk_buff生命周期.md)
