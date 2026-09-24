---
title: "SPDK 性能测试、容量规划与故障排查"
sidebar_label: "08. 性能测试与故障排查"
sidebar_position: 8
description: "使用 perf、bdevperf、fio、spdk_top、iostat 与 Trace，按应用、bdev、NVMe、PCIe、CPU、NUMA 和网络定位问题。"
tags: [SPDK, 性能, bdevperf, fio, spdk_top, NVMe-oF, Runbook]
---

# SPDK 性能测试、容量规划与故障排查

高 IOPS 不等于生产性能好。SPDK 测试必须同时说明块大小、读写比例、随机性、Queue Depth、Job/Core 数、持续时间、数据集、尾延迟和设备稳态。

## 1. 测试前保护数据

随机写、Trim、Verify 和混合写会覆盖目标盘。测试前必须确认：

```text
BDF / Serial / Namespace
没有文件系统、LVM、RAID、Ceph、Swap 或业务引用
测试范围与数据可丢失
电源、温度和散热正常
具有停止测试和恢复驱动的路径
```

不确定时先用 Malloc/Null bdev 验证工具链，再使用专用空盘。

## 2. 三类基准工具

### 2.1 NVMe perf

直接测 SPDK NVMe Driver，尽量减少 bdev 和服务层影响：

```bash
sudo build/examples/perf \
  -q 128 \
  -o 4096 \
  -w randread \
  -t 60 \
  -c 0x3c \
  -r 'trtype:PCIe traddr:0000:af:00.0'
```

适合判断设备、PCIe、QPair 和 NVMe Driver 的上限。

### 2.2 bdevperf

测 bdev 及虚拟层：

```bash
sudo build/examples/bdevperf \
  -m '[2-5]' \
  -q 128 \
  -o 4096 \
  -w randread \
  -t 60
```

适合比较 NVMe、RAID、Crypto、Lvol、AIO 等 bdev 路径。具体 bdev 可通过配置或 RPC 创建。

### 2.3 fio SPDK Plugin

适合沿用 fio Job 模型并与 Kernel ioengine 对比。插件构建与 Job 参数会随 SPDK/fio 版本变化，必须使用目标版本自带文档与示例，不能只替换 `ioengine` 后直接比较。

## 3. 测试矩阵

至少覆盖：

| 变量 | 示例 |
|------|------|
| Block Size | 4K、8K、64K、128K、1M |
| Workload | randread、randwrite、read、write、混合 |
| Read/Write Ratio | 100/0、70/30、0/100 |
| Queue Depth | 1、4、16、32、64、128 |
| Core/QPair | 1、2、4、8，避免超过设备能力 |
| Duration | 预热 + 稳态测试，不能只跑数秒 |
| Dataset | 大于缓存，或明确说明缓存命中 |

报告：

```text
IOPS、MiB/s
Average / P50 / P95 / P99 / P99.9 latency
CPU/Core、cycles per I/O
Device temperature、media/error log
PCIe link、NUMA、power mode
```

## 4. 容量模型

吞吐近似：

```text
Bandwidth = IOPS × Average I/O Size
```

并发近似遵循 Little's Law：

```text
Outstanding I/O ≈ IOPS × Average Latency
```

例如 1,000,000 IOPS、平均 100 µs：

```text
1,000,000 × 0.0001 = 100 outstanding I/O
```

Queue Depth 太低可能喂不满设备；过高会把请求堆在队列里，提高尾延迟。容量目标应是满足延迟 SLO 下的 IOPS，而非设备能够排队的最大请求数。

## 5. 分层排障

```text
业务/Host
→ NVMe-oF Transport
→ Target Poll Group
→ bdev/Virtual Module
→ NVMe QPair
→ PCIe
→ SSD Controller/FTL/Media
```

### 5.1 Reactor 与 Poller

```bash
build/bin/spdk_top -r /var/tmp/spdk.sock
```

观察 Thread 所属 Core、Busy/Idle、Poller 和负载分布。单 Reactor 长期繁忙而其他 Core 空闲，可能是对象 Owner、Poll Group 或 Channel 映射不均。

### 5.2 bdev 统计

```bash
scripts/rpc.py -s /var/tmp/spdk.sock bdev_get_iostat
scripts/rpc.py -s /var/tmp/spdk.sock bdev_get_bdevs
```

比较每个 bdev 的 Read/Write Ops、Bytes 和 Latency。虚拟层与底层统计差异可以帮助判断请求在哪一层排队或放大。

### 5.3 NVMe 与设备健康

设备由 SPDK 接管时，Linux `nvme-cli` 可能无法直接访问。可在维护窗口绑定回内核驱动检查，或使用 SPDK 对应健康/Log Page 能力。重点包括：

- Critical Warning；
- Temperature 与 Thermal Throttling；
- Available Spare、Percentage Used；
- Media/Data Integrity Errors；
- Error Log Entries；
- Controller Reset、Timeout、AER。

### 5.4 PCIe

```bash
lspci -s <BDF> -vv | grep -E 'LnkCap|LnkSta'
dmesg | grep -iE 'aer|pcie|nvme'
```

链路降到更低代际或宽度会形成明显带宽上限。AER、Surprise Down 和 Corrected Error 增长需要联查槽位、背板、Retimer、供电和固件。

### 5.5 NUMA 与 CPU

```bash
ps -L -p <pid> -o pid,tid,psr,pcpu,comm
numastat -p <pid>
perf stat -p <pid> -e cycles,instructions,cache-misses -- sleep 10
```

跨 NUMA Buffer、Reactor 与设备会增加延迟。PMD/Poller 100% 可能是正常忙轮询，要结合 I/O Completion、Busy/Idle 和有效吞吐判断。

## 6. NVMe-oF 特有问题

| 现象 | 优先检查 |
|------|----------|
| Connect 慢或失败 | Discovery、NQN、ACL、路由、防火墙、Transport |
| TCP 吞吐低 | Socket Buffer、拥塞/重传、RSS、Core、MTU |
| RDMA 抖动 | PFC/ECN、CNP、Pause、GID、MTU、QP/RNR/Retry |
| 单路径热点 | ANA、Host Multipath Policy、Hash、连接数 |
| Target CPU 高 | Poll Group、Buffer Copy、TLS/Digest、跨 NUMA |
| SSD 不忙但 Host 延迟高 | 网络、Target Queue、QoS 或 Host Queue |

对 NVMe-oF 必须同时保存 Host、网络和 Target 三端时间窗口，单看 Target 无法区分请求是否已经到达。

## 7. 常见错误归因

### 7.1 加大 Queue Depth 后 IOPS 不升

设备、PCIe、Core 或内存已达上限，或 Workload 只有单一串行依赖。继续加深只会增加延迟。

### 7.2 Malloc bdev 很快，NVMe bdev 很慢

说明上层框架不是主要瓶颈，应检查 PCIe、SSD、QPair、DMA、NUMA、温度和介质后台活动。

### 7.3 NVMe perf 很快，NVMe-oF 慢

差额位于 Target 上层、网络、Host 或额外数据变换。继续比较 bdevperf、本机 nvmf Loopback 和远端路径逐层缩小。

### 7.4 平均时延稳定，P99 周期性尖峰

检查 SSD GC、Thermal、Poller 定时任务、日志、QoS、Host Reconnect、网络拥塞和 CPU 频率变化。

## 8. 生产 Runbook

1. 固定时间窗口和影响范围；
2. 保存版本、启动参数、配置与最近变更；
3. 验证 Host 是否仍连接、路径/ANA 是否变化；
4. 查看 Reactor/Poller/bdev I/O 统计；
5. 对齐 Network、NVMe、PCIe 和设备健康计数；
6. 检查 Core/NUMA/HugePage/VFIO；
7. 用相同 Workload 在基线节点复现；
8. 先恢复服务，再在保留现场上做根因分析；
9. 回归性能、故障切换和数据一致性。

## 9. 课后练习与答案

**问题 1：为什么 4K Random Read 的 IOPS 不能代表模型加载速度？**

模型加载通常是大块顺序读取、元数据、并发和反序列化组合，工作负载与 4K 随机读完全不同。

**问题 2：为什么 Queue Depth 不是越大越好？**

它提高并发但也增加排队；达到设备吞吐上限后继续增加只会扩大尾延迟和超时风险。

**问题 3：如何判断瓶颈在 SPDK 上层还是 SSD？**

比较 Null/Malloc bdev、NVMe perf、NVMe bdev、NVMe-oF 的分层结果，并联合 Reactor、PCIe 和设备健康数据。

## 10. 参考资料

- [SPDK bdevperf](https://spdk.io/doc/bdevperf.html)
- [SPDK NVMe Driver](https://spdk.io/doc/nvme.html)
- [SPDK Tracing](https://spdk.io/doc/trace.html)
- [SPDK Performance Reports](https://spdk.io/doc/performance_reports.html)
