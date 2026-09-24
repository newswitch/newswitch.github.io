---
title: "DPDK 性能调优、容量规划与故障排查"
sidebar_label: "07. 性能调优与故障排查"
sidebar_position: 7
description: "建立 DPDK 基准模型，按物理层、队列、mbuf、CPU、NUMA、内存和应用逐层定位吞吐、尾延迟与丢包。"
tags: [DPDK, 性能, 容量规划, 丢包, NUMA, Runbook]
---

# DPDK 性能调优、容量规划与故障排查

DPDK 性能问题不能只看 CPU 百分比。PMD 忙轮询时核心长期接近 100% 是预期现象，真正要比较的是固定资源下的有效 PPS、Gbps、丢包、尾延迟和每包 CPU 周期。

## 1. 建立可比较的测试合同

每次报告必须记录：

| 类别 | 必须记录 |
|------|----------|
| 硬件 | CPU 型号、Socket、NIC、PCIe 代际/宽度、内存 Channel |
| 软件 | Kernel、Firmware、驱动、DPDK、PMD、编译器和构建参数 |
| 拓扑 | NIC/Core/HugePage NUMA、SMT、IRQ 与 CPU 隔离 |
| 流量 | 包长、协议、流数量、方向、Burst、持续时间 |
| 队列 | RX/TX Queue、Descriptor、RSS、RETA、Offload |
| 结果 | Offered/Forwarded PPS、Gbps、丢包、P50/P99/P99.9、CPU、功耗 |

64 Byte 线速 PPS 和 1500 Byte 带宽测试回答不同问题，不能只写“达到 100G”。以太网线上还包含 Preamble、IFG、FCS 等开销，应用看到的报文长度也可能不同。

## 2. 分层证据

```text
物理链路/FEC
→ NIC MAC/FIFO
→ RX/TX Descriptor
→ PMD Burst
→ Mempool/mbuf
→ 软件 Ring
→ 应用算法与查表
→ 对端和流量发生器
```

### 2.1 物理层

使用 NIC 对应工具或内核绑定状态下的 `ethtool -S` 检查 CRC、Symbol、FEC、Pause、Link Flap。设备已绑定 VFIO 后，原 Linux netdev 统计可能不可用，应使用 DPDK xstats 或厂商工具。

### 2.2 DPDK 端口与队列

testpmd：

```text
show port stats all
show port xstats all
show port info all
show port rss-hash all
show port rss reta all
show config rxtx
```

统计要按时间差计算速率，不能把进程启动以来累计值直接当当前状态。

### 2.3 CPU 与拓扑

```bash
ps -L -p <pid> -o pid,tid,psr,pcpu,comm
perf stat -p <pid> -e cycles,instructions,cache-misses -- sleep 10
numastat -p <pid>
```

观察 PMD Thread 是否迁移、是否与 IRQ/系统任务共享 Core、IPC 与 Cache Miss 是否恶化、远端 NUMA 内存是否增长。

## 3. 容量模型

一个 Core 的可用每包周期近似为：

```text
cycles_per_packet = core_frequency_hz / packets_per_second
```

例如 3 GHz Core 处理 20 Mpps，预算约为：

```text
3,000,000,000 / 20,000,000 = 150 cycles/packet
```

这 150 个周期要覆盖 PMD、解析、查表、修改、统计和 TX。加入加密、深度 ACL 或跨核传递后，很容易超出预算。

实际 Capacity 还受限于：

```text
min(
  NIC line rate,
  PCIe effective bandwidth,
  RX/TX queue capacity,
  total PMD core pps,
  memory/cache bandwidth,
  application stage capacity
)
```

## 4. 常见现象与根因

### 4.1 小包掉速，大包接近线速

更像每包固定成本或 PPS 上限：PMD、解析、查表、Descriptor、Doorbell、Cache Miss。先看 cycles/packet，不要只扩链路带宽。

### 4.2 单队列丢包，其他队列空闲

检查 RSS Key/Hash Fields、RETA、Flow Rule 和流量是否只有少数大象流。增加 Queue 不会自动拆分同一有序流。

### 4.3 `rx_nombuf` 增长

检查 Mempool 容量、Per-lcore Cache、mbuf 泄漏、软件 Ring 积压和 TX 部分发送。单纯扩大池可能掩盖所有权缺陷。

### 4.4 `imissed` 增长但 `rx_nombuf` 不增长

NIC 没有及时获得 Descriptor 或应用轮询不足；检查 PMD 是否被抢占、RXD、Burst、Core/Queue 映射和处理循环是否过重。

### 4.5 平均时延正常但 P99 抖动

检查 CPU 频率、C-State、SMT Sibling、调度迁移、跨 NUMA、批大小、软件 Ring 排队、Periodic Task 和日志。吞吐优化可能扩大批处理等待。

### 4.6 Core 增加但吞吐不升

可能已达到 NIC/PCIe/内存带宽上限，也可能存在共享锁、False Sharing、单 TX Queue、单流 RSS 或串行阶段。

## 5. 调优顺序

1. 固定软件和流量版本；
2. 修正物理链路与错误计数；
3. 对齐 NIC、Core、HugePage NUMA；
4. 确认 CPU 独占、频率与 SMT；
5. 校验 Queue/RSS/RETA 与流量分布；
6. 调整 Descriptor、Burst 和 Mempool；
7. 核对 Offload 与应用报文元数据；
8. Profile 应用算法、Cache Miss 和共享写；
9. 每次只改变一个主要变量并回归。

不要一开始同时修改 Burst、Descriptor、Core、Queue 和 Offload，否则即使结果变好也无法归因。

## 6. 可观测性

生产应采集：

- Port/Queue PPS、Bytes、Drop、Error；
- `imissed`、`rx_nombuf` 和关键 xstats；
- Mempool Free/Used、软件 Ring Occupancy；
- 每 PMD lcore Busy、Cycles、Loop 次数；
- RSS/Flow Rule 使用量与失败；
- Link/FEC/Pause、PCIe AER；
- HugePage、NUMA Remote Access、CPU Frequency/Throttle；
- 业务成功率、时延和重试。

DPDK Telemetry Socket 可由工具查询，但命令与指标随版本和应用注册项变化，应先列出当前实例可用端点，而不是固定解析旧输出。

## 7. 故障现场清单

```text
时间窗口与用户影响
DPDK/PMD/Firmware/Kernel 版本
完整启动参数和启动日志
设备 BDF、Driver、IOMMU Group、NUMA
Port Stats/Xstats 的前后差值
Queue/Core 映射和 CPU Affinity
HugePage 与 Mempool 状态
流量发生器 Offered/Received/Latency
最近配置、固件、镜像或拓扑变化
```

重启会清空累计计数与现场，除非已保存证据或服务恢复优先级明确，否则不应作为第一步。

## 8. 课后练习与答案

**问题 1：PMD Core 100% 是否表示需要扩容？**

不一定。忙轮询本来就会占满核心；应看有效 PPS、空轮询比例、丢包、每包周期和延迟是否达到瓶颈。

**问题 2：为什么调大 RX Descriptor 可能让 P99 变差？**

更深队列能吸收突发，但也允许更多报文排队，应用处理不足时会增加等待时间。

**问题 3：为什么测试必须记录流数量？**

RSS 通常按流分队列。少量大象流和大量均匀小流会得到完全不同的队列利用率和扩展效果。

## 9. 参考资料

- [DPDK Testpmd Runtime Functions](https://doc.dpdk.org/guides/testpmd_app_ug/testpmd_funcs.html)
- [DPDK Telemetry](https://doc.dpdk.org/guides/prog_guide/telemetry_lib.html)
- [DPDK Performance Optimization Guidelines](https://doc.dpdk.org/guides/prog_guide/performance_optimization.html)
