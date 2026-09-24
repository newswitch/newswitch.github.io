---
title: "DPDK 解决什么问题与一次收发包的完整路径"
sidebar_label: "01. 定位与收发包路径"
sidebar_position: 1
description: "对比 Linux Socket 与 DPDK 数据路径，理解 PMD、Burst、DMA、描述符、忙轮询和每包成本。"
tags: [DPDK, PMD, DMA, Descriptor, Burst, Kernel Bypass]
---

# DPDK 解决什么问题与一次收发包的完整路径

DPDK 优化的是高速数据平面的“每包处理成本”和时延抖动。它特别适合小包高 PPS、固定转发逻辑、可独占 CPU 与网卡队列的场景，不是所有网络应用的默认答案。

## 1. 普通 Linux 收包路径

```text
NIC RX Queue
→ DMA 写入驱动准备的 Buffer
→ MSI-X 中断
→ NAPI Poll
→ 构造 skb
→ GRO、Netfilter、路由、TCP/IP
→ Socket Receive Queue
→ epoll 唤醒应用
→ recv()/read() 读取
```

Linux 协议栈提供 TCP 拥塞控制、路由、Netfilter、Namespace、Socket API 和成熟观测工具。代价是通用层次多、对象较重，并可能产生中断、调度、系统调用、共享数据和缓存抖动。

## 2. DPDK 收包路径

```text
HugePage 中的 mbuf Data Room
        ↑ NIC DMA
NIC RX Descriptor Ring
        ↑ PMD 在固定 lcore 上轮询
rte_eth_rx_burst()
        ↓ 返回一批 mbuf 指针
应用解析、查表、修改或转发
rte_eth_tx_burst()
        ↓ 写入 TX Descriptor Ring
NIC DMA 读取 Packet Buffer 并发出
```

关键变化有四个：

1. PMD 在用户态直接管理 NIC Queue；
2. 固定线程忙轮询，避免每批包都等待中断唤醒；
3. 一次处理一批包，用 Burst 分摊 MMIO、同步和函数调用成本；
4. mbuf 来自预分配 Mempool，避免热路径频繁 `malloc/free`。

“内核旁路”不表示内核完全消失。Linux 仍负责进程、页表、HugePage、VFIO、IOMMU、CPU 调度和权限；旁路的是常规网络数据面。

## 3. 从线缆到应用逐步拆解

### 3.1 NIC 接收报文

网卡验证物理帧后，根据 RSS、Flow Director 或其他硬件规则决定进入哪个 RX Queue。每个队列拥有一组 RX Descriptor，Descriptor 描述可供网卡写入的 Buffer 地址与状态。

### 3.2 DMA 写入 Data Room

应用提前把 mbuf 放入 Mempool，再把可用 Buffer 的 IOVA 提交给 NIC。网卡通过 DMA 把报文写入对应 Data Room，不需要 CPU 逐字节复制。

### 3.3 PMD 轮询完成状态

PMD 调用 `rte_eth_rx_burst()` 检查一批 Descriptor。已完成的 Descriptor 对应一组 mbuf 指针，函数把它们返回给应用。

轮询的收益是减少中断和唤醒，代价是空闲时仍占用 CPU。低负载节能与极致低延迟之间需要明确取舍。

### 3.4 应用处理 Packet

应用读取 mbuf 元数据与报文头，执行分类、ACL、NAT、加密、封装或转发。DPDK 不会替应用自动完成完整 TCP/IP 语义；要么应用自行实现，要么使用建立在 DPDK 上的网络栈或产品。

### 3.5 发包与回收

`rte_eth_tx_burst()` 把一批 mbuf 交给 TX Queue。NIC 完成 DMA 读取并发送后，PMD 在后续清理中回收已完成的 mbuf。若发送函数只接受了部分 mbuf，应用必须处理剩余部分，否则会泄漏或丢包。

```c
uint16_t sent = rte_eth_tx_burst(port_id, queue_id, pkts, nb_rx);
for (uint16_t i = sent; i < nb_rx; i++) {
    rte_pktmbuf_free(pkts[i]);
}
```

## 4. 为什么 Burst 很重要

若每次只处理一个包，循环、函数调用、寄存器访问和 Doorbell 成本全部由一个包承担。批处理 32 个包时，这些固定成本可以被一批包共享。

但 Burst 不是越大越好：

| Burst 增大 | 收益 | 代价 |
|------------|------|------|
| 每次取更多包 | 提高吞吐和 Cache 局部性 | 单包等待凑批时间可能增加 |
| 减少 Doorbell 次数 | 降低 MMIO 成本 | 队列积压与尾延迟可能变大 |
| 批量预取 | 降低访存停顿 | 预取错误会污染 Cache |

生产调优必须同时观察 Mpps、Gbps、P50/P99、丢包和 CPU/Core，而不是只追求吞吐峰值。

## 5. Run-to-Completion 与 Pipeline

### 5.1 Run-to-Completion

```text
同一 lcore：RX → Parse → Lookup → Modify → TX
```

优点是跨核通信少、Cache 局部性好；缺点是某个处理阶段过重时会阻塞该队列后续报文。

### 5.2 Pipeline

```text
RX lcore → rte_ring → Worker lcore → rte_ring → TX lcore
```

优点是不同阶段可独立扩展；缺点是增加 Ring、跨核传递、Cache Line 所有权迁移和排队。只有阶段负载不均或需要专用加速时才值得引入。

## 6. DPDK 不适合什么

- 流量很低，独占核心成本无法接受；
- 需要完整、通用、持续更新的内核 TCP/IP 功能；
- 管理口与业务口无法隔离，设备解绑风险过高；
- 团队缺少 HugePage、NUMA、IOMMU 和驱动排障能力；
- 性能瓶颈实际在应用算法、存储或上游，而不在收发包路径；
- 云平台不允许把 PCIe PF/VF 直接交给工作负载。

## 7. 一次请求的延迟预算

```text
网卡接收与 PCIe DMA
+ 等待 PMD 下一次轮询
+ RX Descriptor/mbuf 处理
+ 应用计算与查表
+ 可能的跨核 Ring 排队
+ TX Descriptor 与 Doorbell
+ 网卡发送
```

DPDK 主要降低软件固定成本与抖动，不能消除物理链路、交换机排队、远端处理和协议重传。

## 8. 课后练习与答案

**问题 1：DPDK 为什么不需要为每个包产生系统调用？**

应用映射了设备和 DMA 内存，PMD 可在用户态直接批量读取和更新队列 Descriptor；控制面初始化仍会通过内核接口完成。

**问题 2：GPU 利用率低时部署 DPDK 一定有帮助吗？**

不一定。必须先证明 CPU 网络路径或包处理是瓶颈。如果瓶颈在模型 Prefill、存储读取或请求排队，DPDK 不能直接解决。

**问题 3：轮询为什么会让空闲 CPU 看起来接近 100%？**

PMD lcore 在没有报文时仍不断检查队列。这是忙轮询的设计结果，不等价于业务计算饱和，但会真实占用核心和功耗预算。

## 9. 参考资料

- [DPDK Poll Mode Driver](https://doc.dpdk.org/guides/prog_guide/poll_mode_drv.html)
- [DPDK Ethdev Library](https://doc.dpdk.org/guides/prog_guide/ethdev/ethdev.html)
