---
title: "SPDK NVMe 驱动、Queue Pair 与 DMA"
sidebar_label: "03. NVMe 驱动、队列与 DMA"
sidebar_position: 3
description: "从 Controller、Namespace、Admin Queue、I/O QPair、Doorbell、PRP/SGL 和 Completion 解释 SPDK NVMe 用户态驱动。"
tags: [SPDK, NVMe, Queue Pair, DMA, PRP, SGL]
---

# SPDK NVMe 驱动、Queue Pair 与 DMA

SPDK NVMe Driver 直接在用户态管理 NVMe Controller。要理解它，必须把“磁盘设备名”拆成 Controller、Namespace、Queue Pair、Command、Buffer 和 Completion。

## 1. NVMe 对象

```text
NVMe Subsystem
└─ Controller
   ├─ Admin Submission/Completion Queue
   ├─ I/O QPair 0
   ├─ I/O QPair 1
   └─ Namespace 1..N
```

- Controller：主机与 NVMe 设备交互的控制实体；
- Namespace：向主机暴露的逻辑块地址空间；
- Submission Queue：Host 提交 Command；
- Completion Queue：Controller 返回完成状态；
- QPair：一组 SQ/CQ；
- Doorbell：Host 通知设备队列 Tail/Head 变化的 MMIO 寄存器。

## 2. 设备发现与附加

典型编程流程：

```text
spdk_nvme_probe()
→ probe_cb 判断是否接管
→ attach_cb 获得 Controller
→ 枚举 Namespace
→ 为每个 I/O Thread 分配 I/O QPair
→ 提交异步 Command
→ 周期处理 Completion
```

NVMe 设备绑定给 VFIO 后，Linux `/dev/nvme0n1` 通常会消失。此时应使用 SPDK 工具、RPC 或应用接口查看设备，而不是继续依赖 `lsblk`。

## 3. 为什么每线程一个 QPair

SPDK 推荐固定 Thread 使用独立 I/O QPair：

```text
Thread A → QPair A
Thread B → QPair B
Thread C → QPair C
```

这样提交与完成路径无需跨线程锁。若多个 Thread 共享同一 QPair，应用必须自行同步，并会引入竞争和 Cache 抖动。

QPair 数受 Controller Capabilities、配置和内存约束，不是 Core 越多就能无限创建。

## 4. 一条读命令如何提交

```text
应用提供 Buffer、LBA、Block Count、Callback
→ Driver 分配 Request
→ 构造 NVMe Read Command
→ 用 PRP/SGL 描述 Buffer
→ 写入 SQ Entry
→ 更新 SQ Doorbell
→ Controller 拉取命令并向 Buffer DMA 写数据
→ Controller 写 CQ Entry
→ Poller 读取 Completion 并调用 Callback
```

Doorbell 是 MMIO 写，频繁逐命令更新有成本；队列和实现可能批量处理以分摊开销。

## 5. PRP 与 SGL

NVMe Command 需要告诉设备数据 Buffer 位于哪些 IOVA：

- PRP（Physical Region Page）按页描述数据；
- SGL（Scatter Gather List）可以描述若干离散 Segment；
- 大 I/O 可能需要 PRP List 或多条 SGL Entry；
- Buffer 对齐和长度会影响映射复杂度；
- 设备与 Transport 对最大 SGL 数量有能力限制。

“用户态 Buffer 连续”通常指虚拟地址连续，不代表物理页连续；IOMMU 和 PRP/SGL 完成设备地址映射。

## 6. Admin Queue 与 I/O Queue

Admin Queue 用于 Identify、创建/删除 I/O Queue、Feature、Log Page、Firmware、Namespace Management 等控制命令。I/O Queue 承载 Read、Write、Flush、Compare、Dataset Management 等数据命令。

数据面高负载不应阻塞关键 Admin Command 和健康事件处理。Controller Reset、Firmware、Hotplug 也不能当普通 I/O 处理。

## 7. Completion 与错误

Completion 包含 Status Code Type、Status Code、Command Identifier 和 Phase 等字段。应用不能只判断 Callback 是否被调用，还要解析命令是否成功。

故障分类：

| 层 | 示例 |
|----|------|
| 参数 | LBA 越界、未对齐、长度不支持 |
| Controller | Reset、Fatal Status、Timeout |
| Namespace | Offline、ANA 状态、Capacity 变化 |
| PCIe | AER、Link 降速、Surprise Removal |
| Media | Media Error、Read Only、耗尽 |
| Host | QPair 满、Request Pool 不足、DMA 映射失败 |

## 8. Hotplug 与 Reset

用户态驱动不能假设设备永久存在。移除或 Reset 可能导致：

```text
停止新 I/O
→ 在途请求失败或超时
→ bdev/Controller 发出 Remove Event
→ 上层关闭 Descriptor/Channel
→ 设备重新发现与附加
→ 恢复 Namespace 和服务映射
```

生产应用需要定义数据一致性、重试边界和服务降级，不能只在探测到设备后保存一个永不过期的指针。

## 9. NUMA 与 PCIe

最短路径通常是：

```text
NVMe PCIe Root Port
↔ 同 NUMA Reactor Core
↔ 同 NUMA DMA Buffer
```

检查：

```bash
lspci -tv
lspci -s <NVME_BDF> -vv | grep -E 'LnkCap|LnkSta'
cat /sys/bus/pci/devices/<NVME_BDF>/numa_node
numactl --hardware
```

PCIe `LnkSta` 的速率和宽度低于 `LnkCap` 时，设备性能可能被链路限制。

## 10. 课后练习与答案

**问题 1：SPDK 接管 NVMe 后为什么 `nvme list` 看不到它？**

`nvme-cli` 通过 Linux 内核 NVMe Driver 和设备节点工作；绑定 VFIO 后设备由 SPDK 用户态驱动管理。

**问题 2：为什么一个 QPair 通常只由一个 Thread 使用？**

可以避免提交和完成路径上的锁，并保持 Queue 状态与 Cache 的线程局部性。

**问题 3：虚拟地址连续是否表示设备可用一个物理地址完成 DMA？**

不表示。背后可能是离散物理页，需要 IOMMU 映射或 PRP/SGL 描述。

## 11. 参考资料

- [SPDK NVMe Driver](https://spdk.io/doc/nvme.html)
- [SPDK NVMe Driver Programming Guide](https://spdk.io/doc/nvme_driver.html)
- [NVMe Specifications](https://nvmexpress.org/specifications/)
