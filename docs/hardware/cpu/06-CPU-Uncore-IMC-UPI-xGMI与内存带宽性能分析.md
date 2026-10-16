---
title: "CPU Uncore、IMC、UPI、xGMI 与内存带宽性能分析"
sidebar_label: "06. CPU Uncore 与内存带宽分析"
sidebar_position: 6
description: "从 Core 与 Uncore 的边界出发，使用 IMC、LLC、UPI/xGMI、IIO 和 NUMA 指标解释 CPU 利用率不高但系统已经受内存或互联限制的现象。"
tags: [CPU, Uncore, IMC, UPI, xGMI, NUMA, 内存带宽, PMU, Intel PCM]
---

# CPU Uncore、IMC、UPI、xGMI 与内存带宽性能分析

`top` 显示 CPU 只有 40%，不能证明 CPU 子系统还有 60% 的性能余量。线程可能在等待 LLC、内存控制器、远端 NUMA、PCIe 或锁；设备 DMA 也可能把 IMC 跑满，而 CPU Core 看起来并不繁忙。

要解释这类问题，必须从 Core 指标进入 Uncore。

## 1. Core 与 Uncore 分别是什么

不同 CPU 的实现不同，但可以使用下面的逻辑模型：

```text
CPU Package / Socket
├── Core 0..N
│   ├── Frontend / Branch Predictor
│   ├── Execution Units
│   ├── L1 / L2 / TLB
│   └── PMU
└── Uncore / Data Fabric
    ├── LLC / Last Level Cache
    ├── IMC / Integrated Memory Controller
    ├── UPI / xGMI / Socket Interconnect
    ├── Home Agent / Coherency Agent
    ├── PCIe / CXL Root Complex
    └── Power / Clock / Telemetry
```

Uncore 不是“CPU 以外的设备”，而是同一处理器封装中不属于单个 Core 的共享组件。它连接核心、内存、I/O 和其他 Socket。

## 2. 为什么 Core 利用率不能表示系统余量

操作系统的 CPU 利用率主要描述线程处于运行状态的时间。运行中的线程仍可能：

- 因 LLC Miss 等待 DRAM；
- 因远端 NUMA 访问等待 UPI/xGMI；
- 因共享 Cache Line 产生一致性流量；
- 因内存带宽饱和而排队；
- 忙于 Polling，但没有完成有效业务；
- 被频率、功耗或温度限制；
- 等待设备 Doorbell、Completion 或同步点。

因此需要把利用率、IPC、Cache Miss、内存带宽和互联流量放在同一时间窗口分析。

## 3. 一组指标分别说明什么

| 指标 | 主要对象 | 可以证明什么 | 不能单独证明什么 |
| --- | --- | --- | --- |
| CPU Util | 调度时间 | Core 是否有运行线程 | 每周期是否有效工作 |
| IPC/CPI | 指令退休效率 | Core 执行效率变化 | 具体等待哪一级资源 |
| LLC Miss | 最后级缓存 | 访问未在 LLC 命中 | 一定已经打满 DRAM |
| IMC Read/Write | 内存控制器 | Socket/Channel 的内存流量 | 单个进程贡献 |
| Local/Remote Ratio | NUMA | 访问是否跨 Node | 跨 Socket 一定饱和 |
| UPI/xGMI Traffic | Socket 互联 | 跨 Socket 数据与一致性流量 | 所有流量都来自业务 Payload |
| IIO/PCIe Traffic | I/O Root | 设备进入/离开 Socket 的流量 | 应用端到端吞吐 |

PMU Counter 是硬件计数器，不是无限精度仪器。事件定义、可用数量、复用、Errata、Kernel 和 CPU 代际都会影响结果。

## 4. IMC：真正连接 DIMM 的地方

Integrated Memory Controller 管理 DDR Channel、调度内存请求并统计读写事务。理论带宽为：

```text
理论带宽 = 传输率 × 每 Channel 字节数 × 有效 Channel 数
```

但实际可持续带宽取决于：

- Channel 是否均匀填充；
- DIMM 频率和 Rank 组织；
- Read/Write 比例；
- 顺序、随机和访问步长；
- 并发 Outstanding Request 数量；
- NUMA 分配和数据局部性；
- BIOS、电源、温度和 RAS 模式。

单看 `/proc/meminfo` 只能看到容量，无法知道 IMC 是否饱和。

## 5. UPI 与 xGMI 为什么会成为瓶颈

双路系统中，一个线程访问另一个 Socket 的内存时，典型路径为：

```text
CPU0 Core
→ CPU0 Cache / Coherency Agent
→ UPI 或 xGMI
→ CPU1 IMC
→ CPU1 DIMM
```

设备也会引入远端流量。例如 NIC 挂在 CPU0，而应用线程和 Buffer 位于 CPU1：

```text
NIC DMA
→ CPU0 PCIe Root
→ Socket Interconnect
→ CPU1 Memory
```

随后 CPU0 线程若再次读取该 Buffer，还可能发生反向访问。此时：

- 网卡速率没有下降；
- CPU 总利用率可能不高；
- 但远端访问比例、Socket Link 流量和 P99 会升高。

Intel 使用 UPI/QPI 等名称，AMD EPYC 使用 Infinity Fabric/xGMI。不要把某一厂商工具字段机械映射到另一家平台。

## 6. LLC 与内存带宽的关系

LLC 命中可以减少 DRAM 访问，但 LLC Occupancy 高不等于命中率高；LLC Miss 多也不一定代表 DRAM 带宽饱和。

需要区分：

| 场景 | LLC Miss | DRAM 带宽 | 典型解释 |
| --- | ---: | ---: | --- |
| 工作集可缓存 | 低 | 低 | Cache 有效 |
| 随机指针追逐 | 高 | 可能不高 | 受单次内存延迟限制，无法形成足够并发 |
| 大块流式扫描 | 高 | 高 | 可能受带宽限制 |
| False Sharing | 未必高 | 未必高 | Cache Line 一致性抖动 |
| 设备 DMA | Core 指标不明显 | 可能高 | NIC/NVMe/GPU 在访问 DRAM |

“内存瓶颈”至少包含容量、带宽、延迟、局部性和回收压力五种不同问题。

## 7. Linux PMU 与 Uncore PMU

先查看当前平台暴露了哪些事件源：

```bash
ls /sys/bus/event_source/devices/
perf list | less
```

服务器上可能看到：

```text
cpu
uncore_imc_0
uncore_imc_1
uncore_upi_0
uncore_iio_0
software
tracepoint
```

名称因 CPU、Kernel 和 Driver 不同而变化。不要从其他型号服务器复制 Raw Event 编码；同一个数字在另一代 CPU 上可能代表不同事件。

Core 级基础观察：

```bash
perf stat -a -e cycles,instructions,cache-references,cache-misses -- sleep 10
```

示例：

```text
  1,920,000,000,000      cycles
    825,600,000,000      instructions      # 0.43 insn per cycle
     48,000,000,000      cache-references
     19,200,000,000      cache-misses       # 40.0% of all cache refs
```

低 IPC 与高 Cache Miss 只是线索，还要继续看 IMC 和 NUMA。

## 8. Intel PCM 工具族

Intel Performance Counter Monitor 使用 Core 与 Uncore Counter 提供一组服务器级工具：

| 工具 | 观察对象 |
| --- | --- |
| `pcm` | IPC、频率、Cache、Socket Link、功耗等汇总 |
| `pcm-memory` | Socket、Channel、Rank 的内存读写带宽 |
| `pcm-numa` | 本地与远端内存访问 |
| `pcm-iio` | 按 PCIe Bus/Device 观察 I/O 流量 |
| `pcm-pcie` | Socket 级 PCIe 流量 |
| `pcm-latency` | Cache Miss 与内存延迟相关指标 |
| `pcm-power` | Package、DRAM、频率限制和功耗状态 |

例如：

```bash
sudo pcm-memory 1
```

示意输出：

```text
|---------------------------------------|
|-- Socket 0 --|-- Socket 1 --|--System-|
| Mem Read 92.4| Mem Read 21.8|   114.2 |
| Mem Write 31.7|Mem Write 10.9|    42.6 |
|  GiB/s       |  GiB/s       |  GiB/s  |
```

输出格式和指标因 PCM 版本与 CPU 不同。容器、虚拟机、Secure Boot、`perf_event_paranoid`、MSR 权限和 vPMU 都可能限制采集。

## 9. AMD 平台怎样处理

AMD EPYC 同样存在 Core、LLC、Memory Controller、Data Fabric 与 xGMI，但工具和事件定义不同。可用能力取决于 CPU 代际、Kernel 与平台固件：

- `perf list` 查看 AMD Core/Uncore 事件；
- `numastat` 和 `/sys/devices/system/node` 观察 NUMA；
- `lstopo`、`lscpu` 查看 CCD/Socket/NUMA 拓扑；
- 使用 AMD 官方性能工具时，以目标 CPU 的文档和事件表为准。

文章中的 Intel PCM 命令用于说明观测方法，不代表可以在 AMD 机器上得到同名指标。

## 10. 一个“CPU 40% 但 GPU 吃不饱”的案例

现象：

```text
节点 CPU Util：40%
GPU Util：35%
GPU HBM：已加载权重
Engine 每个 Step 之间存在 20~50 ms 空洞
```

进一步证据：

```text
Tokenizer/EngineCore 固定在 NUMA 0
Pinned Buffer 大量分配在 NUMA 1
GPU 挂在 NUMA 0
Remote Memory Ratio 上升
UPI 流量明显升高
NUMA 0 内存带宽仍有余量
```

推理链路实际是：

```text
CPU0 线程
→ 远端访问 CPU1 内存
→ UPI
→ CPU1 DIMM
→ 再经 UPI 返回 CPU0
→ PCIe Copy 到 GPU
```

此时增加 CPU Core 不一定有效。先让线程、Pinned Memory、IRQ 和 GPU 位于一致的 NUMA 域，再复测 GPU 空洞、TTFT 和吞吐。

## 11. 标准分析步骤

### 11.1 固定边界

记录：

```text
CPU 型号、Socket 数、NUMA 拓扑
DIMM 频率、Channel 与插法
GPU/NIC/NVMe BDF 与 NUMA
Kernel、BIOS、微码和电源策略
容器 CPUSet、Memory Node 与 HugePage
```

### 11.2 建立时间对齐的基线

同时采集：

- 每核 CPU Util、IPC、频率；
- LLC Miss；
- 每 Socket 内存读写带宽；
- 本地/远端访问；
- UPI/xGMI 流量；
- PCIe/IIO 流量；
- 应用吞吐和 P99。

### 11.3 做单变量实验

可以比较：

- NUMA Local 与 Remote；
- 单 Socket 与双 Socket；
- 单设备与多设备并发；
- 一份数据复制与多份复制；
- 绑定线程但不绑定内存，与同时绑定两者。

每次只改变一个变量，否则无法归因。

## 12. 如何判断是哪一种瓶颈

| 证据组合 | 更可能的原因 |
| --- | --- |
| CPU Util 高、IPC 高 | 计算执行或指令吞吐 |
| CPU Util 高、IPC 低、LLC Miss 高 | Cache/内存等待 |
| CPU Util 不高、IMC 带宽高 | DRAM 已成为共享瓶颈或设备 DMA 很重 |
| Remote Ratio 高、UPI/xGMI 高 | NUMA 放置不合理或跨 Socket 共享 |
| IIO 高、IMC 不高 | P2P/设备流量或 PCIe 路径更重要 |
| 单 Socket 正常、跨 Socket 下降 | Socket 互联、远端内存或一致性 |
| 指标周期性波动 | GC、Batch、缓存、功耗或采样窗口混合 |

没有通用的“内存带宽超过 80% 就告警”阈值。要用业务基线、理论能力、实测拐点和 P99 一起判断。

## 13. 容器与虚拟机中的限制

- Pod 内看到的 CPU 利用率可能受 Cgroup 配额影响；
- CPUSet 不自动绑定 Memory Node；
- PMU 可能被宿主机禁止或只暴露部分事件；
- Uncore 是 Socket 共享资源，很难直接按容器归因；
- 虚拟机通常只能看到有限 vPMU，无法读取真实 IMC/UPI；
- 多个监控工具同时编程 Counter 可能互相影响。

因此生产采集通常在节点侧完成，再通过 PID、CPUSet、时间窗口和实验设计完成归因。

## 14. 常见误区

### 14.1 CPU 空闲就表示内存还有余量

错误。设备 DMA 和少量高带宽线程都可能打满 IMC。

### 14.2 LLC Miss 高就一定要增加 Cache

错误。流式扫描本来就很难复用；随机访问则可能更受延迟限制。需要结合带宽、访问模式和业务结构。

### 14.3 绑核等于完成 NUMA 优化

错误。线程、内存页、IRQ、设备和 HugePage 都要检查归属。

### 14.4 PCM 数字就是某个进程的流量

错误。大部分 Uncore 指标是 Socket/Channel/Port 级共享计数，需要通过隔离实验或其他观测完成归因。

## 15. 练习与答案

**问题：CPU 利用率 30%，`pcm-memory` 显示本 Socket 内存带宽已接近该机器的实测拐点，继续加线程是否一定提高吞吐？**

答案：不一定。更多线程可能只增加内存请求排队、Cache 竞争和上下文开销。应比较吞吐、P99、IPC 和内存带宽随并发的曲线，确认是否已进入带宽饱和区。

**问题：远端 NUMA 访问比例升高为什么可能拖慢 GPU？**

答案：GPU 前处理、Pinned Buffer 或通信数据需要先跨 Socket 取得，再进入 GPU 所属 PCIe Root；额外的 UPI/xGMI 延迟和共享带宽会在 GPU Kernel 之间制造空洞。

**问题：为什么设备 DMA 流量可能看不到明显的 Core Cache Miss？**

答案：DMA 由设备和 I/O/内存子系统执行，不要求 CPU Core 对每个字节执行 Load/Store。应观察 IMC、IIO/PCIe 和设备 Counter，而不是只看 Core PMU。

## 16. 参考资料

- [Intel Performance Counter Monitor](https://github.com/intel/pcm)
- [Linux perf_event_open](https://man7.org/linux/man-pages/man2/perf_event_open.2.html)
- [Linux NUMA Memory Policy](https://www.kernel.org/doc/html/latest/admin-guide/mm/numa_memory_policy.html)
- [AMD EPYC 9004 BIOS and Workload Tuning Guide](https://docs.amd.com/api/khub/documents/goX~9ubv8i5r60A_Qrp3Rw/content)
