---
title: "多队列、RSS、RPS、XPS 与卸载：网络包如何分散到多个 CPU"
sidebar_label: "12. 多队列、RSS、RPS、XPS 与卸载"
sidebar_position: 12
description: "解释 NIC 多队列、RSS/RPS/RFS/XPS、IRQ affinity、GRO/GSO/TSO、checksum offload 与抓包错觉。"
tags: [Linux, RSS, RPS, XPS, TSO, GRO]
---

# 多队列、RSS、RPS、XPS 与卸载：网络包如何分散到多个 CPU

高速网卡需要多个 RX/TX queue 与 CPU 并行处理。硬件 hash、IRQ affinity、软件转向和应用线程放置共同决定一个流由哪个 CPU 处理。

## 1. RSS

Receive Side Scaling 由网卡根据包头字段计算 hash，把流映射到 RX queue。相同流通常保持同队列以避免乱序，多流才能自然扩展到多队列。

```bash
ethtool -l <interface>
ethtool -x <interface>
grep -i <driver-or-interface> /proc/interrupts
```

单条大流可能只压满一个队列/CPU，增加队列数也不会把同一 TCP 流任意拆到所有核。

## 2. RPS 与 RFS

- RPS 在软件层按 hash 把接收协议处理转交其他 CPU，适合硬件队列不足等情况，但增加跨 CPU 队列和 IPI。
- RFS 在 RPS 基础上尝试让包靠近消费该 Socket 的应用 CPU，提高 Cache 局部性。

硬件 RSS 已合理分布时，额外 RPS 可能无收益甚至增加开销。

## 3. XPS

Transmit Packet Steering 根据 CPU/队列映射为发送选择 TX queue，减少队列锁竞争并改善局部性。还要与 qdisc、多队列设备和应用线程位置协调。

## 4. IRQ affinity

MSI-X 向量通常对应队列。irqbalance 可自动分配，也可手工设置：

```bash
cat /proc/irq/<IRQ>/smp_affinity_list
cat /sys/class/net/<iface>/queues/rx-*/rps_cpus
cat /sys/class/net/<iface>/queues/tx-*/xps_cpus
```

手工掩码易因 CPU hotplug、NUMA、队列变化和服务绑核失效，应纳入配置管理和验证。

## 5. 分段与聚合卸载

| 能力 | 方向 | 作用 |
|---|---|---|
| TSO | TX 硬件 | NIC 把大 TCP skb 分成线上帧 |
| GSO | TX 软件框架 | 在更后阶段进行通用分段 |
| GRO | RX 软件 | 合并可聚合包，减少协议处理次数 |
| LRO | RX 设备/驱动 | 更激进聚合，路由/转发场景有边界 |
| checksum offload | TX/RX | 由设备计算/验证部分校验和 |

## 6. 抓包错觉

- 发送端抓包可能看到大于 MTU 的 GSO/TSO skb。
- TX checksum 在抓包时尚未由 NIC 填写，显示 incorrect。
- 接收端 GRO 后抓包可能看到聚合记录。

对端或交换机镜像更接近线上帧，但也有自身 offload/采集边界。

## 7. NUMA 和设备局部性

NIC、IRQ CPU、Socket 应用线程和内存缓冲位于同一 NUMA Node 通常更有利。RDMA/GPUDirect 场景还要加入 GPU PCIe/NVLink 拓扑，不能只做网卡绑核。

## 8. 练习与答案

**问题：8 队列网卡为什么单 TCP 流仍只用一个 CPU 较多？**

答案：RSS 通常按流 hash 保持顺序，同一流映射一个 RX queue；需要多流或其他明确并行机制才能利用多队列。

**问题：tcpdump 显示 checksum incorrect 是否一定是坏包？**

答案：不是。发送抓包点可能早于硬件 checksum offload 填充，应结合 offload 设置和对端抓包。

下一篇：[Network Namespace、veth、Bridge 与 VXLAN](./13-Network-Namespace-veth-Bridge与VXLAN.md)
