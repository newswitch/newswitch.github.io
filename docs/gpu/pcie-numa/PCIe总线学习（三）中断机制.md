---
title: PCIe总线学习（三）中断机制
date: 2025-11-01 16:00:00
categories: 高性能网络
tags: [PCIe, MSI, MSI-X, IRQ, NUMA, 高性能网络]
---

# PCIe 总线学习（三）：从 INTx、MSI-X 到 IRQ 亲和性

PCIe 设备通过 DMA 搬运数据，通过中断通知 CPU“某件事已经发生”。高性能网卡、NVMe、GPU
都依赖这套机制，但中断并不是数据本身，也不是越多越好。

本文从零解释 INTx、MSI、MSI-X，再把硬件向量、Linux IRQ、设备队列、CPU 和 NUMA 串成
一条可观测、可调优、可排障的路径。

## 1. 学习目标

完成本文后，应能够：

- 区分 INTx、MSI 和 MSI-X 的触发方式与能力边界；
- 解释“设备向一个特殊地址写数据”为什么能触发 CPU 中断；
- 从 PCIe Capability 找到 MSI/MSI-X 状态；
- 把网卡队列、MSI-X Vector、Linux IRQ 和 CPU 对应起来；
- 使用 `/proc/interrupts`、sysfs、`lspci`、`ethtool` 定位中断问题；
- 在 NUMA、RSS、irqbalance 和中断合并之间做有证据的调优。

前置知识：建议先阅读[基本架构](./PCIe总线学习（一）基本架构.md)和
[地址空间](./PCIe总线学习（二）地址空间.md)。

## 2. 先建立完整心智模型

以网卡收到一个数据包为例：

```text
报文到达 NIC
→ NIC 使用 DMA 把数据写入内存中的 Rx Ring/Buffer
→ NIC 更新完成状态
→ NIC 发出 MSI-X Memory Write
→ Root Complex / Interrupt Remapping 单元处理消息
→ Local APIC/GIC 把中断送到目标 CPU
→ Linux IRQ Handler 运行
→ 驱动/NAPI 处理一批完成项
→ 协议栈继续处理数据
```

这里有两个必须分开的通道：

| 通道 | 搬运什么 | 典型机制 |
|---|---|---|
| 数据通道 | 报文、NVMe 数据、GPU Buffer | DMA / PCIe TLP |
| 通知通道 | “队列有新完成项” | INTx / MSI / MSI-X |

中断只负责通知。即使关闭中断并改用轮询，DMA 数据仍然可以到达；反过来，中断不断增长也不
代表业务数据一定被正确处理。

## 3. 为什么不能给每个 PCIe 设备单独拉一根中断线

SoC 内置外设的数量通常在设计时已知，可以把中断线直接连接到中断控制器。PCIe 设备却可以
通过 Switch 动态扩展，系统设计时不知道最终会插入多少设备、每个设备需要多少队列。

PCI/PCIe 因而经历了三种中断方式：

| 类型 | 触发方式 | 向量能力 | 共享 | 典型用途 |
|---|---|---:|---|---|
| INTx | 传统电平语义，在 PCIe 内封装成消息 | 1 个常见 | 是 | 兼容旧设备 |
| MSI | 设备执行特殊 Memory Write | 最多 32 个 | 否 | 较早的多向量设备 |
| MSI-X | 表项定义独立地址和数据 | 最多 2048 个 | 否 | 多队列 NIC、NVMe 等 |

现代高性能设备通常优先使用 MSI-X，但驱动仍可能在平台能力不足时退回 MSI 或 INTx。

## 4. INTx：共享中断的兼容方案

传统 PCI 定义 INTA#、INTB#、INTC#、INTD# 四根中断线。多个设备共享中断，驱动收到中断后
还要读取设备状态寄存器，确认是否由自己的设备触发。

PCIe 链路没有真正的并行 INTx 引脚，因此用 Assert_INTx/Deassert_INTx 消息传递传统电平语义。
经过 PCIe Bridge 时还可能根据 Device Number 做 Interrupt Swizzling，让设备尽量分散到四个
入口。

![INTX中断](/images/PCIE总线学习（三）/INTX中断.png)

INTx 的主要限制：

- 多设备共享，处理程序需要判断中断来源；
- 电平触发，需要正确完成 Assert 与 Deassert；
- 单设备难以把多个队列分别绑定到不同 CPU；
- 高负载下容易形成单 IRQ/单 CPU 瓶颈。

在 `lspci -vv` 中看到 `Interrupt: pin A` 不等于设备当前一定使用 INTx，还要继续查看
MSI/MSI-X Capability 是否 `Enable+`，并结合 `/proc/interrupts` 判断。

## 5. MSI：把中断变成一次 Memory Write

MSI（Message Signaled Interrupt）不再依赖共享中断线。系统在设备初始化时为它配置：

```text
Message Address：写到哪里
Message Data：写什么值
```

设备需要通知 CPU 时，发出一个不带普通业务数据语义的 PCIe Memory Write TLP。Root Complex
和中断控制器识别该地址/数据，把消息转换为目标 CPU 上的中断向量。

MSI Capability 位于 PCI 配置空间的 Capability 链中，包含：

- MSI Enable；
- 32/64 位 Message Address；
- Message Data；
- Multiple Message Capable / Enable；
- 可选的 Per-Vector Mask/Pending。

![MSI中断-1](/images/PCIE总线学习（三）/MSI中断-1.png)

![MSI中断-2](/images/PCIE总线学习（三）/MSI中断-2.png)

一个设备可申请多个 MSI 向量，但数量和布局限制比 MSI-X 更强。对大量硬件队列，MSI-X 通常
更灵活。

## 6. MSI-X：为多队列设备准备的独立向量表

MSI-X 使用设备 BAR 空间中的 MSI-X Table 保存表项，并用 PBA（Pending Bit Array）记录被
Mask 时等待处理的中断。

每个 MSI-X Table Entry 通常包含：

```text
Message Address Low
Message Address High
Message Data
Vector Control（含 Mask 位）
```

MSI-X 相比 MSI 的关键能力：

- 最多支持 2048 个表项；
- 每个向量可有独立 Message Address/Data；
- 每个向量可以单独 Mask；
- 队列与中断向量可以建立更细粒度映射；
- 更适合把不同队列分散到不同 CPU/NUMA 域。

注意：“设备有 128 个 MSI-X 表项”不等于 Linux 一定分配 128 个 IRQ。驱动会按 CPU 数、硬件
队列数、模块参数、内核策略和可用资源申请一部分向量，也可能让多个队列共享一个向量。

## 7. Linux 驱动如何申请中断向量

现代 PCI 驱动通常使用 `pci_alloc_irq_vectors()` 或带 Affinity 的接口申请向量，再用
`pci_irq_vector()` 取得 Linux IRQ 号。

下面是理解流程的简化伪代码，不可直接当成完整驱动：

```c
int nvec;

nvec = pci_alloc_irq_vectors(pdev,
                             1,
                             wanted_queues,
                             PCI_IRQ_MSIX | PCI_IRQ_MSI | PCI_IRQ_INTX);
if (nvec < 0)
    return nvec;

for (int i = 0; i < nvec; i++) {
    int irq = pci_irq_vector(pdev, i);
    request_irq(irq, queue_handler, 0, queue_name[i], queue[i]);
}

/* 设备停止、所有 IRQ 已释放后 */
pci_free_irq_vectors(pdev);
```

这段流程说明三层编号不能混为一谈：

| 名称 | 示例 | 含义 |
|---|---|---|
| MSI-X Table Index | 0、1、2 | 设备内部表项编号 |
| Linux IRQ | 185、186 | 内核分配的 IRQ 编号 |
| CPU | 8、9 | 当前处理 IRQ 的处理器 |

Linux IRQ 编号不是 PCIe Vector Index，也不是固定不变的硬件号码。

## 8. 多队列设备为什么依赖 MSI-X

### 8.1 网卡

多队列 NIC 通常包含多个 Rx/Tx Queue。RSS 根据报文哈希把流量送入不同 Rx Queue，每个队列
或队列组可对应独立 MSI-X IRQ，从而在多个 CPU 并行处理。

```text
Flow Hash → Rx Queue 7 → MSI-X Vector 7 → Linux IRQ 192 → CPU 23
```

Linux NAPI 会在中断到来后暂时转为预算轮询，一次处理多个包，避免每个包都产生完整中断开销。
因此高吞吐时“报文数远大于中断数”是正常现象。

### 8.2 NVMe

NVMe 使用 Submission Queue 和 Completion Queue。多个 Completion Queue 可以关联不同 MSI-X
向量，让不同 CPU 处理本地提交的 I/O 完成。队列、IRQ 和 NUMA 放置不合理时，会增加跨 NUMA
访问和尾延迟。

### 8.3 GPU

GPU 驱动使用中断处理控制事件、错误、复制/执行完成等通知，但不会简单地为每个 CUDA Kernel
都执行一次昂贵的用户可见中断。GPU 数据搬运、命令队列和完成机制由驱动与硬件协同完成。

在 AI 服务器中，中断调优最常见的对象仍是高速 NIC、NVMe 和存储网卡；GPU 性能问题则要同时
检查 PCIe、NUMA、驱动、Kernel 时间线和通信库。

## 9. 在 Linux 中建立“设备—向量—IRQ—CPU”映射

以下示例使用 BDF `0000:65:00.0`，执行前替换成自己的设备。

### 9.1 找到设备与 NUMA

```bash
lspci -Dnn
lspci -s 0000:65:00.0 -vv
cat /sys/bus/pci/devices/0000:65:00.0/numa_node
cat /sys/bus/pci/devices/0000:65:00.0/local_cpulist
```

重点观察：

```text
LnkSta：当前链路速率与宽度
MSI: Enable+/-
MSI-X: Enable+/- Count=...
Vector table / PBA 所在 BAR 与偏移
NUMA Node
Kernel driver in use
```

`Count` 是设备能力，不是已分配 IRQ 数量。

### 9.2 查看设备实际分配的 MSI IRQ

```bash
ls -1 /sys/bus/pci/devices/0000:65:00.0/msi_irqs/
grep -iE 'mlx|eth|nvme|nvidia' /proc/interrupts
```

如果 `msi_irqs` 不存在或为空：

1. 确认设备是否真的启用 MSI/MSI-X；
2. 查看驱动是否加载；
3. 检查内核启动参数是否禁用 MSI；
4. 查看 `dmesg` 中的 PCI、IRQ、IOMMU 和驱动错误；
5. 确认设备是否退回 INTx。

### 9.3 查看 IRQ 亲和性

假设 IRQ 为 192：

```bash
cat /proc/irq/192/smp_affinity_list
cat /proc/irq/192/effective_affinity_list
cat /proc/irq/192/node
```

`smp_affinity_list` 是配置目标，`effective_affinity_list` 是内核最终生效范围。Managed IRQ、CPU
离线状态和内核策略都可能让两者不同。

## 10. IRQ Affinity、RSS、RPS、XPS 与 NUMA

### 10.1 硬件接收路径

```text
RSS Hash
→ NIC Rx Queue
→ MSI-X IRQ
→ IRQ Affinity CPU
→ NAPI/SoftIRQ
→ Socket/Application
```

理想状态通常是：队列处理 CPU 靠近 NIC 所在 NUMA Node，并与应用线程、内存分配策略协调。
如果 IRQ 在 NUMA 0、应用和 Buffer 在 NUMA 1，数据可能频繁跨 UPI/Infinity Fabric。

### 10.2 查看队列和 RSS

```bash
ethtool -l eth0
ethtool -x eth0
ethtool -S eth0
```

- RSS：硬件把流分配到 Rx Queue；
- RPS：软件把接收处理转移到其他 CPU；
- XPS：选择发送队列/CPU；
- IRQ Affinity：决定硬件队列中断先在哪个 CPU 进入内核。

同时启用很多机制不一定更快。优先让硬件 RSS 与 IRQ/NUMA 合理，再判断是否需要 RPS/XPS。

### 10.3 手工修改前必须处理 irqbalance

```bash
systemctl status irqbalance
```

`irqbalance` 可能覆盖手工设置。不要直接在生产机停止它；先记录当前分布、明确哪些 IRQ 要排除，
并准备恢复方案。

实验环境可将 IRQ 绑定到 CPU List：

```bash
echo 8-11 | sudo tee /proc/irq/192/smp_affinity_list
```

不要把所有队列都绑到一个 CPU，也不要机械地“一队列一个逻辑 CPU”。最优队列数取决于 CPU
能力、NUMA、流量模型、中断合并和应用线程。

## 11. 中断合并：延迟与吞吐的权衡

高速网卡可以等待一段时间或积累若干完成项后再触发中断：

```bash
ethtool -c eth0
ethtool -C eth0 rx-usecs 8 rx-frames 32
```

第二条只是实验示例，不能直接复制到生产。

| 配置倾向 | 优点 | 风险 |
|---|---|---|
| 更少合并 | 单包通知快 | IRQ/SoftIRQ 开销高 |
| 更多合并 | 吞吐高、CPU 开销低 | 排队与尾延迟增加 |
| Adaptive | 自动随负载变化 | 行为需要基线验证 |

RDMA 和低延迟推理网络关注 P99/P999，批量存储传输更关注吞吐与 CPU。必须用真实业务或接近真实
消息大小的基准测试决定。

## 12. 常见故障与证据链

### 12.1 单个 CPU 被 IRQ 打满

现象：某个 CPU `%irq/%soft` 很高，其他 CPU 空闲，网卡 Queue Drop 增长。

```bash
grep -i eth /proc/interrupts
mpstat -P ALL 1
ethtool -S eth0 | grep -iE 'drop|miss|timeout|queue'
```

检查：队列数、RSS Indirection、IRQ Affinity、irqbalance、NUMA 和应用线程分布。

### 12.2 IRQ 数量少于硬件队列

这不一定是故障。驱动可能合并队列、受 CPU 数或模块参数限制。先比较：

```text
MSI-X Count（能力）
→ 驱动创建的 Combined Queue 数
→ msi_irqs 数量
→ /proc/interrupts 中实际活动 IRQ
```

### 12.3 中断计数不增长

可能原因：没有流量、观察错 Function、设备使用轮询、队列没有映射到该 IRQ、驱动未启动、设备
复位失败或已经退回其他中断模式。

### 12.4 中断风暴

现象：IRQ 快速增长但吞吐很低，CPU 消耗很高。检查设备错误、队列是否无法清空、中断合并、驱动
日志、链路错误和固件。不要只提高合并参数掩盖硬件/驱动故障。

### 12.5 重启或 Resume 后设备异常

设备复位、休眠恢复和 AER 错误恢复后，驱动需要恢复 MSI/MSI-X 状态。检查：

```bash
dmesg -T | grep -iE 'pci|pcie|aer|msi|irq|reset|timeout'
lspci -s 0000:65:00.0 -vv
```

如果重载驱动才恢复，应继续调查固件、内核版本、驱动恢复路径和平台 BIOS，而不是把重载当根因修复。

## 13. 可复现实验

只在实验节点或已隔离的生产节点执行调优。

### 阶段 A：建立静态拓扑

保存：

```bash
lspci -Dtv
lspci -s 0000:65:00.0 -vv
numactl --hardware
ethtool -l eth0
ethtool -x eth0
```

画出：

```text
PCIe BDF → NUMA Node → Queue → MSI-X IRQ → CPU
```

### 阶段 B：建立负载基线

运行合适的 `iperf3`、RDMA perftest 或存储基准，同时采集：

```bash
watch -n 1 'grep -i eth /proc/interrupts'
mpstat -P ALL 1
pidstat -wru 1
ethtool -S eth0
```

记录吞吐、平均/P99 延迟、IRQ/SoftIRQ、丢包和每队列计数。

### 阶段 C：一次只改变一个变量

依次验证：

1. 默认 irqbalance；
2. IRQ 绑定近端 NUMA CPU；
3. 不同 Combined Queue 数；
4. 不同中断合并参数；
5. 应用线程近端与远端 NUMA；
6. 恢复默认配置后结果是否回归。

没有原始输出、时间戳、配置 Diff 和恢复验证的“调优结论”不可复现。

## 14. 与 GPU、网卡、存储链路的关系

```text
GPU Kernel / DMA
↕ PCIe / NVLink
NIC 或 NVMe 队列
→ MSI-X IRQ
→ CPU/NUMA
→ 驱动、协议栈或存储栈
→ Kubernetes Pod / 训练与推理进程
```

GPUDirect RDMA 的大块数据可以直接在 NIC 与 GPU Memory 之间 DMA，但控制面、Completion、错误
处理和部分慢路径仍依赖 CPU、驱动与中断/轮询机制。“数据绕过 CPU”不等于“CPU 和 IRQ 不重要”。

## 15. 掌握标准

- [ ] 能画出 INTx、MSI、MSI-X 的触发路径；
- [ ] 能解释 MSI-X Table 与 PBA；
- [ ] 能区分设备向量编号、Linux IRQ 和 CPU；
- [ ] 能从 BDF 找到 MSI IRQ、NUMA 和当前 CPU 亲和性；
- [ ] 能把 NIC Queue、RSS、IRQ、NAPI 和 SoftIRQ 串起来；
- [ ] 能判断高 IRQ 是正常高负载、配置不均还是中断风暴；
- [ ] 能通过 A/B 实验量化 Affinity 与中断合并的收益；
- [ ] 能说明为什么 GPUDirect RDMA 仍需要关注 CPU/IRQ 慢路径。

## 参考资料

- [Linux Kernel：The MSI Driver Guide HOWTO](https://www.kernel.org/doc/html/next/PCI/msi-howto.html)
- [Linux Kernel：How To Write Linux PCI Drivers](https://www.kernel.org/doc/html/next/PCI/pci.html)
- [Linux Kernel：Scaling in the Linux Networking Stack](https://www.kernel.org/doc/html/latest/networking/scaling.html)
- [Linux Kernel：SMP IRQ Affinity](https://www.kernel.org/doc/html/latest/core-api/irq/irq-affinity.html)
