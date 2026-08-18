---
title: "NVMe 队列、Namespace 与性能模型"
sidebar_label: "01. NVMe 队列、Namespace 与性能模型"
sidebar_position: 1
description: "从 PCIe、Controller、Submission/Completion Queue、Namespace 到 Linux blk-mq，理解 NVMe 的并行性能、时延与排障方法。"
tags: [NVMe, SSD, PCIe, blk-mq, Namespace, 性能]
---

# NVMe 队列、Namespace 与性能模型

NVMe SSD 不只是“更快的磁盘”。它为非易失存储设计了多队列命令接口，使多个 CPU 核能够并行提交大量 I/O；但应用只有在块大小、队列深度、NUMA、文件系统和介质稳态都匹配时，才能获得设计能力。

本文回答：

- NVMe Controller、Namespace 和 `/dev/nvme0n1` 是什么关系？
- Submission Queue 与 Completion Queue 如何工作？
- 为什么 QD1 延迟与 QD128 峰值 IOPS 不能混用？
- 多队列为什么仍可能被单 CPU、PCIe、温度或 FTL 限制？
- 如何定位 timeout、reset、降速和持续写入掉速？

## 1. 从设备命名理解对象

常见 Linux 名称：

```text
/dev/nvme0       → NVMe controller 字符设备
/dev/nvme0n1     → controller 0 上的 namespace 1 块设备
/dev/nvme0n1p1   → namespace 1 上的第 1 个分区
```

一台设备可能有一个或多个 Controller；一个 Controller 可以管理一个或多个 Namespace。Namespace 向主机暴露连续逻辑块地址空间，类似可被格式化和分区的块设备。

Namespace 不是普通目录，也不等同于 LVM logical volume。它由 NVMe 设备/子系统提供，可能具有独立容量、LBA 格式、标识和共享关系。

## 2. NVMe 与 PCIe

本地 NVMe 通常通过 PCIe 连接：

```text
CPU / PCIe Root Complex
  → PCIe switch（可选）
  → NVMe controller
  → NAND channels / media
```

性能上限受以下共同限制：

- PCIe 代际和链路宽度；
- 实际协商速率与宽度；
- Controller 处理能力；
- NAND channel、die 并行度与介质类型；
- FTL、垃圾回收和写放大；
- 温度与功耗限制；
- 软件栈、CPU 和 NUMA。

链路能工作不代表以目标速度工作。检查：

```bash
lspci -nn | grep -i 'non-volatile memory'
lspci -vv -s <pci-address>
cat /sys/class/nvme/nvme0/address
cat /sys/class/nvme/nvme0/device/numa_node
```

在 `lspci -vv` 中比较设备能力与当前 `LnkSta`；字段格式依版本。若协商宽度/速率低于设计值，还需检查插槽、BIOS、转接卡和共享 lane。

## 3. Controller 与 Namespace

### 3.1 Controller

Controller 实现 NVMe 命令处理、队列、错误恢复、固件、日志页和 Namespace 管理。查看：

```bash
nvme list
nvme id-ctrl /dev/nvme0
```

### 3.2 Namespace

Namespace 定义逻辑块空间。查看：

```bash
nvme list-ns /dev/nvme0
nvme id-ns /dev/nvme0n1
lsblk -o NAME,SIZE,PHY-SEC,LOG-SEC,FSTYPE,MOUNTPOINTS,MODEL
```

创建、删除、格式化 Namespace 或修改 LBA format 都可能破坏数据，不能作为只读排查命令。在生产环境必须按设备文档、兼容矩阵和变更流程执行。

### 3.3 多 Namespace 是否等于性能隔离

不一定。多个 Namespace 可能共享同一个 Controller、缓存、NAND channel 和功耗/温度预算。它们提供逻辑隔离，但是否有性能/QoS 隔离取决于设备能力和配置。

## 4. Submission Queue 与 Completion Queue

NVMe 使用成对队列：

```text
Host memory
  Submission Queue (SQ): 主机写入命令
  Completion Queue (CQ): 控制器写入完成项

CPU 写 SQ entry
→ 更新 doorbell
→ Controller 取命令并执行
→ Controller 写 CQ entry
→ 中断/轮询通知 CPU
→ Host 回收完成
```

命令描述符和队列位于主机内存，Controller 通过 DMA 访问。NVMe 支持很多 I/O 队列，使不同 CPU/软件队列减少共享锁争用。

### 4.1 Admin Queue

Admin SQ/CQ 用于 Identify、创建 I/O queue、日志、固件和管理命令。普通数据读写主要走 I/O queues。

### 4.2 Doorbell

主机向内存队列写入命令后，通过 MMIO doorbell 通知 Controller 队列 tail 更新。完成端用 phase tag 和 head 管理 CQ 消费。

学习重点是生产者/消费者模型，不必在初学阶段死记寄存器偏移。

## 5. Linux blk-mq 如何对接 NVMe

Linux 块层多队列大致分为：

```text
应用/文件系统 bio
→ per-CPU software queue
→ hardware dispatch queue
→ NVMe I/O queue
→ controller
```

blk-mq 试图让请求在接近提交 CPU 的队列上处理，减少全局锁并利用多核。实际队列数量受设备能力、驱动、CPU 数、模块参数和系统配置影响。

查看：

```bash
ls -1 /sys/block/nvme0n1/mq/
cat /sys/block/nvme0n1/queue/nr_requests
cat /sys/block/nvme0n1/queue/scheduler
cat /sys/block/nvme0n1/queue/max_sectors_kb
```

不要在不了解影响时修改队列参数。虚拟化、device-mapper、RAID 和云盘可能让路径不是直接 NVMe。

## 6. 队列深度与时延

### 6.1 QD1

一次只有一个在途 I/O，接近同步、延迟敏感应用。设备不能充分并行，但反映低负载时延。

### 6.2 深队列

多个命令并行，可让 NAND channels 与 Controller 保持忙碌，提高 IOPS/吞吐。达到饱和后，继续增加只会排队。

```text
Observed latency = software queue + controller queue + media/service + completion
```

### 6.3 `numjobs × iodepth`

`fio` 中总并发近似为 jobs 与每 job 深度的乘积，但同步引擎、文件系统锁和 CPU 限制会使实际深度低于配置。必须检查 fio 的 I/O depth distribution 和 `iostat aqu-sz`。

## 7. 块大小与工作负载

### 7.1 小块随机 I/O

- 关注 IOPS 与 P99；
- Controller、FTL、CPU 和队列开销明显；
- 深队列可提高 IOPS但增加延迟；
- 写放大和 GC 影响更大。

### 7.2 大块顺序 I/O

- 关注 GiB/s；
- PCIe 与 NAND 聚合带宽更关键；
- 请求可能被块层/设备最大传输限制拆分；
- 单流未必填满设备，需要有限并发。

AI 模型本地缓存主要是大文件顺序读取，Checkpoint staging 是大写入，而容器/日志可能是小随机混合。不要用单一 4 KiB IOPS 评价节点所有用途。

## 8. 延迟路径与中断/轮询

完成通知可使用 MSI-X 中断，系统也可能在某些高性能路径采用轮询。中断亲和性与 NUMA 会影响 CPU cache 和跨节点访问。

查看：

```bash
cat /proc/interrupts | grep -i nvme
grep . /proc/irq/<irq>/smp_affinity_list
cat /sys/class/nvme/nvme0/device/numa_node
numactl --hardware
```

不要为了跑分随意固定 IRQ。需要同时考虑 CPU 隔离、网络 IRQ、GPU feeder thread、调度器和功耗；错误亲和性可能造成单核热点。

## 9. FTL、垃圾回收与写放大

NAND 不能像 DRAM 一样原地覆盖：通常按页写、按块擦除。FTL 维护 LBA 到物理位置映射。持续随机写会产生：

- 无效页迁移；
- 垃圾回收；
- 写放大；
- 可用空闲块下降；
- 尾延迟尖峰；
- NAND 磨损。

### 9.1 为什么新盘短测很快

空盘有大量可用块，部分 SSD 还有动态 SLC cache。写满或长时间稳态后，持续写吞吐可能明显降低。因此测试要区分：

```text
fresh-out-of-box / burst / steady state
```

### 9.2 Over-Provisioning 与剩余空间

保留空间有助于 FTL 垃圾回收，但具体管理方式与设备有关。文件系统 `df` 有空余不一定等同于设备已获得可回收空间；discard/TRIM 行为也取决于文件系统、挂载和设备。

## 10. SLC Cache、温度和功耗

观察长时间写入曲线：

```text
高突发阶段 → cache 用尽 → 持续阶段下降
```

温度过高还可能触发 thermal throttling，使读写随时间下降。设备健康信息：

```bash
nvme smart-log /dev/nvme0
nvme error-log /dev/nvme0
```

关注但不要机械解释：temperature、available spare、percentage used、media errors、unsafe shutdowns、error log。字段和阈值以设备手册与 NVMe 规范为准。

## 11. NUMA 与 GPU/NIC 拓扑

AI 节点中 NVMe、GPU 和 NIC 可能连接到不同 CPU socket：

```text
NUMA 0: GPU0-3 + NIC0 + NVMe0
NUMA 1: GPU4-7 + NIC1 + NVMe1
```

当数据从 NVMe0 被 NUMA1 CPU 线程读取，再传到 GPU7，可能跨 CPU interconnect；若还经过 NIC，路径更复杂。

检查：

```bash
nvidia-smi topo -m
lspci -tv
cat /sys/class/nvme/nvme0/device/numa_node
cat /sys/class/net/<nic>/device/numa_node
```

优化要建立在 profiler 和 A/B 证据上。将进程、内存、NVMe IRQ 和 GPU 全部强行绑到一处，可能挤压 CPU 或破坏其他数据流。

## 12. Namespace、分区、LVM、文件系统的层次

```text
NVMe Controller
→ Namespace /dev/nvme0n1
→ GPT partition（可选）
→ md RAID / LVM / dm-crypt（可选）
→ ext4/XFS
→ mount point
→ model cache / container data
```

每增加一层都带来能力与运维责任。排查必须先用 `lsblk`、`findmnt` 和 LVM/md 工具还原真实映射，不要看到 `/dev/nvme0n1` 就假定应用直接使用它。

## 13. 基线测试方法

### 13.1 只读识别

```bash
nvme list
lsblk -o NAME,KNAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,MODEL,SERIAL
findmnt
lspci -vv -s <pci-address>
```

序列号等资产信息可能敏感，归档时按安全规范脱敏。

### 13.2 低负载延迟

专用测试文件上使用 4 KiB random read、QD1，记录 P50/P99。

### 13.3 并发曲线

扫描 QD 1/2/4/8/16/32/64，记录 IOPS、P99、CPU 和队列。找到延迟拐点。

### 13.4 大文件带宽

使用 1 MiB 顺序读写、逐步增加有限并发。写测试必须使用可销毁测试空间，并观察足够长时间的持续性能。

### 13.5 多设备与 NUMA

分别测每块盘，再测聚合；若聚合不等于单盘之和，检查 PCIe 上行、CPU、内存、软件 RAID 和散热。

详细实验设计见[存储性能指标与 fio 压测方法](../linux-io/03-存储性能指标与fio压测方法.md)。

## 14. 故障与性能退化排查

### 14.1 timeout/reset

```bash
journalctl -k --since "1 hour ago" | grep -iE 'nvme|pcie|aer|timeout|reset'
nvme error-log /dev/nvme0
```

保存时间、PCI 地址、Controller/Namespace、固件、内核和受影响文件系统。频繁 reset 可能导致 I/O 尾延迟、文件系统错误或设备消失。

### 14.2 协商降速

对比 `LnkCap` 与 `LnkSta`，检查 BIOS、插槽、转接卡、背板和 AER。不要只重启后宣布恢复。

### 14.3 持续写掉速

检查测试是否越过 SLC cache、盘是否接近满、温度、GC、discard、写放大和混合负载。用时间序列而非总平均。

### 14.4 单盘性能异常

在相同节点、版本、温度、working set 和 job 下与同型号盘对比。若异常随盘移动，偏设备；若留在插槽，偏 PCIe/主板；若随节点，偏系统/软件/散热。

### 14.5 文件系统慢但裸设备基线正常

检查空间、inode、碎片、journal、CoW、快照、thin pool、mount options 和同步语义。禁止在有数据的设备上用裸写覆盖来“验证”。

## 15. NVMe-oF 的边界

NVMe over Fabrics 将 NVMe 命令通过 RDMA/TCP/FC 等 Fabric 传输：

```text
应用 → 本地块层 → NVMe-oF initiator → 网络
→ target → 后端 NVMe/storage
```

它在 Linux 上可能仍呈现 `/dev/nvme...`，但延迟路径多了 NIC、网络、Target 和后端。看到设备名是 NVMe 不代表物理盘在本机。

检查 transport：

```bash
nvme list-subsys
```

本地 PCIe 与 NVMe/TCP、NVMe/RDMA 的性能和故障域不能混为一谈。

## 16. 节点模型缓存的使用边界

本地 NVMe 很适合模型缓存，因为：

- 大文件顺序读高；
- 可减少共享存储回源；
- 节点重建后可以重新下载；
- 与 GPU 的拓扑可预测。

但它不应保存唯一副本：

- 节点或盘损坏会丢失；
- Local PV 会把 Pod 与节点绑定；
- 容量水位和多模型淘汰需要治理；
- 盘满可能影响容器运行时和 kubelet；
- 多进程并发下载需要锁和原子发布。

具体治理见[节点模型缓存与容量水位](../ai-workloads/08-节点模型缓存与容量水位治理.md)。

## 17. 常见误区

1. **NVMe 名称代表本地物理盘。**也可能是 NVMe-oF 或虚拟设备。
2. **多 Namespace 提供物理性能隔离。**通常仍共享 Controller 和介质。
3. **队列越深越好。**峰值提高但 P99 失控。
4. **PCIe Gen4 x4 标称就是实测速率。**有编码、协议和系统开销，还需确认协商。
5. **新盘短时写入代表持续写。**SLC cache、GC 和温度会改变曲线。
6. **`%util=100%` 等于 NVMe 达峰。**并行设备需要看吞吐和延迟曲线。
7. **单盘峰值可以线性相加。**可能共享 PCIe switch、CPU、内存和散热。
8. **本地 NVMe 是持久模型仓库。**节点级缓存必须可重建。

## 18. 掌握标准

应能：

- 画出 Controller—Namespace—分区/LVM—文件系统层次；
- 解释 SQ/CQ、doorbell、DMA 和 completion；
- 解释 blk-mq 多队列与 NUMA 的关系；
- 用 QD/块大小扫描找到吞吐—延迟拐点；
- 区分 burst 与 steady-state 写性能；
- 检查 PCIe 协商、温度、SMART、reset 和 error log；
- 判断问题随设备、插槽、节点还是负载移动；
- 为 AI 节点设计可重建的本地模型缓存，而不把缓存当唯一数据。

下一篇：[RAID、LVM 与文件系统选型](./02-RAID%20LVM与文件系统选型.md)。

## 19. 参考资料 {/* #参考资料 */}

- [NVM Express specifications](https://nvmexpress.org/specifications/)
- [Linux NVMe documentation](https://docs.kernel.org/nvme/index.html)
- [Linux blk-mq](https://docs.kernel.org/block/blk-mq.html)
- [nvme-cli](https://github.com/linux-nvme/nvme-cli)
- [Linux block statistics](https://docs.kernel.org/admin-guide/iostats.html)
