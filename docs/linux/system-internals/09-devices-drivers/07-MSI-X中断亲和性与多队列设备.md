---
title: "MSI-X、中断亲和性与多队列设备：队列怎样映射到 CPU"
sidebar_label: "07. MSI-X、亲和性与多队列"
sidebar_position: 7
description: "从硬件队列、MSI-X vector、IRQ affinity、NUMA 和应用线程解释 NIC/NVMe 多队列性能。"
tags: [Linux, MSI-X, IRQ Affinity, Multiqueue, NUMA]
---

# MSI-X、中断亲和性与多队列设备：队列怎样映射到 CPU

多队列设备通过并行 Ring/Submission Queue 减少锁竞争，但只有硬件队列、中断、CPU、内存和应用线程形成合理映射，队列数才会转化为吞吐和低延迟。

## 1. 映射链

```text
NIC RSS hash / NVMe queue selection
→ hardware queue
→ MSI-X vector
→ Linux IRQ
→ IRQ affinity CPU
→ NAPI/blk completion
→ Socket/应用线程或发起 IO 的 CPU
```

其中任何一层集中，都可能出现单核热点。增加队列也会增加中断、内存、doorbell 和管理成本。

## 2. NIC 与 NVMe 差异

- NIC RX 流通常由 RSS 哈希保持同流有序，TX queue 常按发送 CPU/队列映射选择。
- NVMe blk-mq 常按 CPU 映射 hardware context，submission/completion queue 与中断向量相关。

二者都依赖 MSI-X，但队列选择和上层语义不同。

## 3. NUMA 局部性

设备接在某个 PCIe Root Complex 下，DMA 到本地 NUMA 内存、由本地 CPU 处理通常代价更低。跨 Socket 路径会经过 UPI/xGMI 等互连，但不是“CPU 核心逐字节搬运”。

```bash
cat /sys/class/net/<ifname>/device/numa_node
cat /sys/block/<dev>/device/numa_node 2>/dev/null
grep -iE '<driver>|nvme|mlx|eth' /proc/interrupts
```

## 4. 调优前先找瓶颈

1. 确认实际队列和 vector 数。
2. 观察每队列 packets/bytes/completions 和 drop。
3. 对齐 IRQ、softirq、应用线程和内存 Node。
4. 检查是否是单大流、单线程或 cgroup/cpuset 限制。
5. 改一个变量，回归吞吐、P99、CPU 与丢包。

盲目把 IRQ 均匀撒到全部 CPU，可能破坏 Cache/NUMA 局部性；把所有 IRQ 挪出业务核也可能让跨核唤醒增加。

## 5. 练习与答案

**问题：64 核服务器把 NIC 队列设为 64 是否必然最佳？**

答案：不必然。流量并行度、PCIe/NUMA、驱动上限、应用线程和单队列负载决定收益，过多队列还会增加开销。

**问题：IRQ 在 CPU0，应用在 CPU1，数据必须由 CPU0 复制到 CPU1 吗？**

答案：不一定发生显式复制，但缓存行所有权、唤醒和共享队列访问会跨核，产生一致性与互连开销。

下一篇：[固件、热插拔、电源管理与驱动故障](./08-固件热插拔电源管理与驱动故障.md)
