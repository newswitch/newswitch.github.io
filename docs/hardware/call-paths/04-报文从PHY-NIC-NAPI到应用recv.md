---
title: "一个报文从 PHY、NIC、NAPI 到应用 recv"
sidebar_label: "04. PHY、NIC、NAPI 到 recv"
sidebar_position: 4
description: "追踪以太网报文经过 PHY、MAC、RSS、RX Ring、DMA、MSI-X、NAPI、XDP、GRO、TCP Socket Queue 到应用 recv 的完整路径。"
tags: [PHY, NIC, RX Ring, DMA, NAPI, recv]
---

# 一个报文从 PHY、NIC、NAPI 到应用 recv

接收报文时，CPU 通常不会主动到网卡里“取数据”。Driver 预先提供 Host Memory Buffer，NIC 收到 Frame 后通过 DMA 写入，再用中断或状态变化通知 CPU 批量处理。

## 1. 物理接收

```text
Cable / Fiber
→ PMD / SerDes
→ Clock Recovery
→ PCS / FEC / Lane Alignment
→ MAC / FCS Check
→ NIC Parser
```

FEC 可先纠正部分 Bit Error；无法纠正的错误可能形成 PCS、CRC 或丢帧计数，上层甚至看不到这个报文。

## 2. RSS 选择 RX Queue

NIC 通常根据 Header 字段计算 Hash：

```text
5-Tuple 等字段
→ RSS Hash
→ Indirection Table
→ RX Queue
```

同一 Flow 通常进入同一 Queue 以保持顺序，多 Flow 才能自然分散到多个 Queue/CPU。隧道流量还取决于 NIC 是否解析 Inner Header。

## 3. Driver 预投 RX Buffer

在报文到来前：

1. Driver 分配 Page/Buffer；
2. 建立 DMA Mapping；
3. 把 DMA Address 写进 RX Descriptor；
4. 更新 Ring，交给 NIC 使用。

如果 CPU/内存压力导致 Buffer 补充失败，NIC 可能因 No Buffer 丢包，尽管物理链路无 CRC 错误。

## 4. NIC DMA 写入内存

```text
NIC 收到 Frame
→ 选择 RX Descriptor
→ DMA 写 Host Memory
→ 写入长度、Checksum、VLAN、Timestamp 等 Completion Metadata
→ 触发 MSI-X 或等待 Interrupt Moderation
```

DMA 目标页面可能通过 IOMMU 映射。NIC 和目标内存的 NUMA 距离会影响访问路径。

## 5. 中断与 NAPI

低流量时，中断快速通知 CPU；高流量时，每包中断成本过高。NAPI 的基本思路：

```text
中断到达
→ 暂停/抑制该 Queue 中断
→ 调度 NAPI Poll
→ 在 Budget 内批量收包
→ Ring 清空后重新启用中断
```

因此中断次数少于包数是正常的。Budget 耗尽会把剩余工作留到后续 Poll，而不是无限占用 CPU。

## 6. XDP 位置

支持 Native XDP 时，程序可在较早的 Driver RX 路径处理报文：

- XDP_DROP：直接丢弃；
- XDP_PASS：继续进入 Kernel Stack；
- XDP_TX：从当前接口发回；
- XDP_REDIRECT：重定向到其他接口、CPU 或 AF_XDP。

报文被 XDP_DROP 后不会进入 TCP，也不会出现在普通 Socket 抓包点。

## 7. SKB、GRO 与协议栈

通过 XDP 后，Kernel 构建或关联 SKB：

```text
Ethernet/VLAN
→ IP 校验与路由
→ Netfilter（按 Hook/配置）
→ TCP/UDP
→ Socket Lookup
→ Socket Receive Queue
```

GRO 可把同一 Flow 的多个连续报文合并为较大对象，减少后续每包开销。因此 Kernel 抓包和应用读取粒度不一定等于线上 Frame 粒度。

## 8. TCP 接收

TCP 还要处理：

- Sequence 与乱序队列；
- Checksum；
- 重组 Byte Stream；
- ACK、Receive Window；
- Socket Memory 上限；
- 应用读取速度和 Backpressure。

应用读取慢会让 Receive Queue 增长并缩小接收窗口，即使 NIC 和链路完全正常。

## 9. 应用 recv

```text
应用调用 recv()
→ Socket Receive Queue 有数据：Copy to User 并返回
→ 没有数据：阻塞、等待事件或返回 EAGAIN
```

阻塞线程被数据到达唤醒后仍需等待调度器获得 CPU。报文已在 Socket Queue 不等于应用立即运行。

## 10. 丢包位置

| 层次 | 示例 |
| --- | --- |
| PHY/MAC | FEC 不可纠正、CRC、Alignment |
| NIC | No RX Buffer、Hardware Filter |
| Driver/NAPI | Ring、Budget、CPU/IRQ 拥塞 |
| XDP/TC | Policy Drop、Redirect 失败 |
| IP/Netfilter | 路由、分片、防火墙 |
| TCP/UDP | Socket Buffer、Checksum、无监听端口 |
| Application | 读取慢、Event Loop 阻塞 |

只看 `ip -s link` 无法覆盖所有层次。

## 11. 观测方法

```bash
ethtool -S eth0
ip -s link show dev eth0
cat /proc/interrupts
cat /proc/net/softnet_stat
ss -tinm
nstat
```

结合 XDP/TC/Netfilter 规则和应用 Profile。Counter 名称、累积范围和清零行为因驱动而异。

## 12. 练习与答案

**问题：NIC 已把报文 DMA 到内存，为什么应用仍可能几毫秒后才读到？**

答案：之后还有 NAPI、协议栈、Socket Queue、唤醒和线程调度；CPU 拥塞、GRO、Interrupt Moderation 和应用事件循环都会增加等待。

**问题：物理端口无 CRC，能否证明主机没有丢包？**

答案：不能。RX Ring、No Buffer、XDP、Netfilter、Socket Buffer 和应用处理都可能丢弃或阻塞。

延伸阅读：[接收路径：DMA、IRQ 与 NAPI](../../linux/system-internals/07-network-stack/01-packet-path/03-接收路径-DMA-IRQ-NAPI.md)。
