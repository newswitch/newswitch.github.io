---
title: "DPDK Ethdev、PMD 与网卡收发队列"
sidebar_label: "03. Ethdev、PMD 与网卡队列"
sidebar_position: 3
description: "深入理解 ethdev 抽象、PMD、Descriptor、Burst、RSS、Flow、Offload 和队列到核心映射。"
tags: [DPDK, Ethdev, PMD, RX Queue, TX Queue, RSS, Offload]
---

# DPDK Ethdev、PMD 与网卡收发队列

`rte_ethdev` 向应用提供统一的以太网设备 API，PMD（Poll Mode Driver）把这些 API 实现为具体网卡硬件操作。应用不应把“端口、队列、lcore、CPU 和物理接口”混为一个对象。

## 1. 对象关系

```text
PCIe Function / vdev
→ DPDK ethdev port_id
  ├─ RX Queue 0 → PMD lcore 2
  ├─ RX Queue 1 → PMD lcore 3
  ├─ TX Queue 0 ← PMD lcore 2
  └─ TX Queue 1 ← PMD lcore 3
```

- `port_id`：DPDK 进程内的逻辑端口编号，不是 Linux ifindex；
- Queue：硬件或虚拟设备中的收发队列；
- lcore：运行收发循环的逻辑执行单元；
- Descriptor：CPU 与 NIC 交换 Buffer 地址、长度和完成状态的队列项。

## 2. 端口初始化顺序

典型 API 顺序：

```text
rte_eth_dev_info_get()
→ rte_eth_dev_configure()
→ rte_eth_rx_queue_setup()
→ rte_eth_tx_queue_setup()
→ rte_eth_dev_start()
→ rte_eth_promiscuous_enable()（按需）
→ rx_burst / tx_burst 循环
```

必须先读取 `rte_eth_dev_info`，再根据设备实际能力选择队列数、Descriptor 数和 Offload。请求硬件不支持的 Offload 会导致配置失败，或在不同 PMD 上产生不同回退行为。

## 3. RX Descriptor 生命周期

```text
应用准备 mbuf
→ PMD 把 mbuf IOVA 写入 RX Descriptor
→ NIC 收包并 DMA 到 Data Room
→ NIC 更新 Descriptor 完成状态和长度
→ PMD 批量读取完成项
→ 应用获得 mbuf
→ PMD 用新 mbuf 补充 RX Ring
```

若 Mempool 没有可用 mbuf，RX Queue 无法补充 Buffer，会出现 `rx_nombuf` 等计数增长。此时扩大 Descriptor 只能延迟问题，根因可能是 mbuf 泄漏、Mempool 太小或应用处理太慢。

## 4. TX Descriptor 生命周期

```text
应用提交 mbuf
→ PMD 写 TX Descriptor
→ NIC DMA 读取报文
→ NIC 发包并标记完成
→ PMD 清理完成项
→ mbuf 回到 Mempool
```

TX Ring 过小可能在突发流量下很快填满；过大则占用更多内存并可能隐藏排队、增加尾延迟。

## 5. RSS 如何把流分到多个队列

RSS（Receive Side Scaling）通常对报文头字段做 Toeplitz Hash，再根据 RETA（Redirection Table）选择 RX Queue：

```text
五元组
→ RSS Hash
→ RETA Entry
→ RX Queue
→ 绑定该 Queue 的 lcore
```

同一流通常进入同一队列以保持顺序。流量分布不均时可能是：

- 流数量太少或存在大象流；
- RSS Hash 字段未包含期望的隧道内层；
- RETA 分布不均；
- NIC/PMD 不支持所配置的 Hash 类型；
- 流量被硬件 Flow Rule 提前导向固定队列。

不能只看到“配置了 8 个队列”就假设 8 个核心会均匀工作。

## 6. rte_flow 与 RSS 的关系

`rte_flow` 用于向硬件或 PMD下发匹配与动作，例如：

```text
匹配 VLAN / IPv4 / UDP / VXLAN / Inner 5-tuple
→ Queue / RSS / Drop / Mark / Count / Meter 等动作
```

规则能否硬件卸载取决于 NIC、固件、PMD 和匹配组合。创建成功也要用 Query、硬件计数和实际流量验证，不能仅依赖配置返回值。

## 7. Offload 不是免费的

| Offload | 作用 | 可能问题 |
|---------|------|----------|
| RX/TX Checksum | 校验或生成校验和 | mbuf flag/长度填写错误导致坏包 |
| TSO | 硬件分段大 TCP 报文 | 隧道与头长度配置复杂 |
| VLAN Strip/Insert | 硬件处理 VLAN Tag | 抓包看到的报文与线上线缆不同 |
| RSS | 多队列分流 | Hash 字段或 RETA 导致倾斜 |
| Flow Offload | 硬件匹配和动作 | 资源表耗尽、规则组合不支持 |
| Timestamp | 硬件时间戳 | 时钟域、同步和队列能力不同 |

性能测试要记录启用了哪些 Offload。关闭校验和后吞吐下降，不应直接归因于代码退化。

## 8. Queue、Core 和 NUMA 映射

常见起点是一条繁忙 RX Queue 对应一个 PMD lcore。同一个 Queue 不应被多个 lcore 无协调地同时轮询。

```text
NIC 0 / NUMA 0
  RXQ0 ↔ CPU2 ↔ Mempool0
  RXQ1 ↔ CPU3 ↔ Mempool0

NIC 1 / NUMA 1
  RXQ0 ↔ CPU18 ↔ Mempool1
  RXQ1 ↔ CPU19 ↔ Mempool1
```

跨 Socket 访问不仅增加平均延迟，还可能让 P99 在流量高峰明显恶化。

## 9. 关键统计

基础统计：

```text
ipackets/opackets
ibytes/obytes
ierrors/oerrors
imissed
rx_nombuf
```

`xstats` 提供 PMD 和硬件相关的队列、丢包、FIFO、CRC、Pause、Buffer 等计数。名称不跨网卡统一，必须结合 NIC Datasheet 与 PMD Guide 解释。

故障归因示例：

| 现象 | 更可能的方向 |
|------|--------------|
| `imissed` 增长 | NIC/RX Ring 来不及接收、应用轮询不足 |
| `rx_nombuf` 增长 | Mempool 枯竭或 mbuf 未及时回收 |
| 单队列包量极高 | RSS/Flow/流量模型倾斜 |
| TX 返回值长期小于请求值 | TX Ring/链路/清理或对端背压 |
| CRC/Length Error | 线缆、模块、物理层或报文异常 |

## 10. 课后练习与答案

**问题 1：8 个 RX Queue 是否必须使用 8 个 Core？**

不是绝对必须，但繁忙队列通常需要独立轮询能力。一个 Core 可以轮询多个低流量 Queue，代价是调度公平性和尾延迟更复杂。

**问题 2：`rx_nombuf` 增长为什么不一定是网卡故障？**

它表示 PMD 无法从 Mempool 获得 RX Buffer，常见原因是池太小、包未释放或处理积压。

**问题 3：为什么硬件 Offload 必须写进性能报告？**

因为它改变 CPU 实际承担的工作量。不同 Offload 配置下的吞吐和 CPU 不能直接横向比较。

## 11. 参考资料

- [DPDK Ethdev Library](https://doc.dpdk.org/guides/prog_guide/ethdev/ethdev.html)
- [DPDK Poll Mode Driver](https://doc.dpdk.org/guides/prog_guide/poll_mode_drv.html)
- [DPDK rte_flow](https://doc.dpdk.org/guides/prog_guide/rte_flow.html)
