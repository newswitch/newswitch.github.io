---
title: "NIC Queue、Descriptor、DMA、中断与 Offload"
sidebar_label: "01. NIC 队列、DMA 与 Offload"
sidebar_position: 1
description: "追踪网卡收发包的 Ring、Descriptor、DMA、Doorbell、MSI-X、RSS 和硬件卸载路径。"
tags: [NIC, DMA, Descriptor, RSS, MSI-X, Offload]
---

# NIC Queue、Descriptor、DMA、中断与 Offload

网卡不是 CPU 把每个字节“写到网线”的外设。CPU 和驱动准备缓冲区及 Descriptor，NIC 通过 DMA 与 Host Memory 交换报文，再由 MAC/PHY 发到介质。

## 1. 网卡内部组件

```text
PCIe Interface / DMA Engine
  ├── TX Queue / RX Queue
  ├── Packet Buffer
  ├── Parser / RSS / Flow Table
  ├── Checksum / Segmentation / Crypto Offload
  ├── MAC
  └── PHY / SerDes 或外接模块接口
```

高端 NIC 还可能包含 RDMA、Switch、Embedded CPU、Memory 和可编程 Pipeline，但基本收发逻辑仍围绕 Queue、Descriptor 和 DMA。

## 2. Descriptor 与 Ring

Descriptor 是队列中的元数据，常包含：

- 缓冲区 DMA 地址；
- 长度和分段信息；
- Offload 标志；
- Ownership/完成状态；
- VLAN、Checksum、Timestamp 等结果。

Ring 是循环使用的 Descriptor 数组。Ring 满意味着 Producer 追上 Consumer，并不等于网线带宽已满，可能是 CPU 未及时回收或设备未及时完成。

## 3. 一次发包

```text
协议栈构造 Packet Buffer
→ Driver 映射 DMA 并填写 TX Descriptor
→ 更新 Tail / Doorbell
→ NIC DMA 读取 Descriptor 和报文
→ Offload / MAC / PHY 发出
→ NIC 写回完成状态
→ Driver 回收 Buffer
```

频繁写 Doorbell 会增加 MMIO 开销，因此驱动常批量提交。批量过大又可能增加尾延迟。

## 4. 一次收包

```text
Driver 预先投放空 RX Buffer
→ 物理链路收到 Frame
→ MAC 校验，Parser/RSS 选择 Queue
→ NIC DMA 写入 Host Buffer
→ 更新 RX Completion
→ MSI-X 中断或 Polling
→ NAPI/Userspace Driver 批量处理
```

如果 RX Buffer 补充不及时，网卡即使物理链路正常也可能丢包。

## 5. 中断、NAPI 与 Polling

- MSI-X：不同 Queue 使用不同中断向量，便于多核并行；
- Interrupt Moderation：合并中断，降低 CPU 开销但增加等待；
- NAPI：高负载时从中断切换到预算式轮询；
- Busy Poll/DPDK Poll Mode：CPU 持续轮询换取更低延迟。

“中断越少越好”与“延迟越低越好”存在权衡，应按 PPS、CPU 预算和尾延迟调优。

## 6. RSS 与多队列

RSS 通常对五元组等字段 Hash，将不同 Flow 分配到 RX Queue。目标是：

- 同一 Flow 保持顺序；
- 多 Flow 分散到多个 CPU；
- IRQ、Queue 与应用线程保持 NUMA/Cache 局部性。

单条 TCP Flow 通常不会因增加 RSS Queue 自动使用所有 Core。多队列不均衡可能来自 Hash、流量基数、IRQ 亲和性或应用消费能力。

## 7. 常见 Offload

| Offload | 作用 | 排障注意 |
| --- | --- | --- |
| TX/RX Checksum | 硬件计算/验证校验和 | 抓包点可能显示“未计算”假象 |
| TSO/GSO | 大 Buffer 分段为多个报文 | 发送前抓包看到超大 Packet |
| GRO/LRO | 合并多个接收报文 | 抓包形态与线速报文不同 |
| VLAN Offload | 插入/剥离 VLAN Tag | 主机抓包可能看不到 Tag |
| RSS | Flow 分配到多 Queue | 需核对 Hash Key/Indirection |
| RDMA | 绕过传统 Socket 数据路径 | 仍依赖 PCIe、NIC、链路和队列 |

排障时可临时关闭某项 Offload 做对照，但要评估性能影响并在实验后恢复。

## 8. PCIe 与 NUMA

```text
Application CPU
→ Local/Remote Memory
→ IOMMU
→ PCIe Root / Switch
→ NIC DMA
```

最佳情况下，应用线程、内存、IRQ 与 NIC 位于同一 NUMA Node。跨 Socket 不会让报文“经过 CPU Core 转发”，但 DMA 目标内存或 CPU 访问可能经过 Socket Interconnect。

## 9. 证据与排障

```bash
ethtool -i eth0
ethtool -k eth0
ethtool -l eth0
ethtool -g eth0
ethtool -S eth0
cat /proc/interrupts
lspci -s 65:00.0 -vv
```

分析顺序：

1. 驱动、固件、PCIe Link 和 NUMA；
2. Queue 数、Ring、IRQ 与 CPU 分布；
3. NIC 丢包、No Buffer、Timeout、Reset 计数；
4. MAC/PHY 的 CRC、FEC 和链路状态；
5. 对端端口与业务重传时间线。

不同厂商统计名不统一，应先查驱动文档，不能只按字段包含 `drop` 就判定链路丢包。

## 10. 练习与答案

**问题：网卡 RX Ring 调得越大越好吗？**

答案：不是。更大 Ring 能吸收短时突发，但也增加内存占用和排队上限，可能放大尾延迟。应结合突发、处理速率和丢包计数调整。

**问题：为什么主机抓包显示校验和错误，而交换机和对端没有错误？**

答案：抓包点可能位于硬件 Checksum Offload 之前，内核看到的 Buffer 尚未填最终校验和。这是常见观测假象，需要对照 Offload 状态和对端抓包。
