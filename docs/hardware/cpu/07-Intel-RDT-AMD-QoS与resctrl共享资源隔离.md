---
title: "Intel RDT、AMD QoS 与 resctrl：LLC 和内存带宽共享资源隔离"
sidebar_label: "07. resctrl 共享资源隔离"
sidebar_position: 7
description: "解释多租户进程即使使用不同 CPU Core 仍会争抢 LLC 和内存带宽，并使用 Linux resctrl 理解 CMT、MBM、CAT 与 MBA 的监控和控制边界。"
tags: [Intel RDT, AMD QoS, resctrl, CAT, CMT, MBM, MBA, LLC, 内存带宽]
---

# Intel RDT、AMD QoS 与 resctrl：LLC 和内存带宽共享资源隔离

两个 Pod 使用完全不同的 CPU Core，仍可能互相影响。原因是 Core 独占不等于 Socket 独占，它们还会共享 LLC、内存控制器、Socket 互联、PCIe Root、功耗和散热预算。

`resctrl` 是 Linux 暴露 CPU Cache 与内存带宽监控/分配能力的文件系统接口。Intel 将相关硬件能力称为 RDT，AMD 文档中常称 Platform QoS。具体支持项取决于处理器与 Kernel，并不是所有机器都同时拥有监控和控制能力。

## 1. CPUSet 没有隔离什么

```text
Pod A → Core 0-7  ┐
                  ├→ Shared LLC → IMC → DDR
Pod B → Core 8-15 ┘
```

CPUSet 可以限制线程在哪些逻辑 CPU 上运行，但通常没有自动隔离：

- LLC Capacity 与 Cache Way；
- 内存带宽；
- Memory Controller Queue；
- UPI/xGMI；
- PCIe 与 I/O；
- Package Power/Thermal Budget。

所以“CPU 利用率没有满、CPU Core 也没有重叠”仍不能排除硬件共享资源竞争。

## 2. 四组核心能力

| 能力 | 英文 | 主要作用 |
| --- | --- | --- |
| CMT | Cache Monitoring Technology | 监控任务的 LLC Occupancy |
| MBM | Memory Bandwidth Monitoring | 监控总内存带宽和本地内存带宽 |
| CAT | Cache Allocation Technology | 通过 Cache Bitmask 约束可使用的 LLC Ways |
| MBA | Memory Bandwidth Allocation | 对内存带宽施加硬件延迟或软件带宽控制 |

监控和分配是两类能力。某台机器可能支持 MBM，却不支持 MBA；也可能只支持 L3 CAT，不支持 L2 CAT。

## 3. Linux resctrl 模型

挂载后，`resctrl` 使用目录表示资源控制组和监控组：

```text
/sys/fs/resctrl/
├── info/          # 当前硬件支持的资源与约束
├── schemata       # 根组资源配置
├── tasks          # 根组线程
├── cpus           # 根组 CPU
└── group-a/
    ├── schemata
    ├── tasks
    ├── cpus
    └── mon_data/
```

资源控制组回答“允许使用哪些资源”，监控组回答“这些任务实际用了多少”。不要把它当成普通 Cgroup Controller：它有独立的文件系统、硬件约束和调度语义。

## 4. 先确认机器是否支持

检查 Kernel 配置与 CPU 能力：

```bash
grep -E 'CONFIG_X86_CPU_RESCTRL|CONFIG_RESCTRL' /boot/config-$(uname -r)
grep -E 'rdt_a|cat_l3|cqm_llc|cqm_mbm|mba' /proc/cpuinfo | head
```

挂载并读取能力：

```bash
sudo mount -t resctrl resctrl /sys/fs/resctrl
find /sys/fs/resctrl/info -maxdepth 2 -type f -print
```

可能出现：

```text
/sys/fs/resctrl/info/L3/cbm_mask
/sys/fs/resctrl/info/L3/min_cbm_bits
/sys/fs/resctrl/info/L3/num_closids
/sys/fs/resctrl/info/MB/num_closids
/sys/fs/resctrl/info/L3_MON/num_rmids
```

新 Kernel 更推荐读取 `info/`，因为 `/proc/cpuinfo` Feature Flag 不一定完整表达所有新能力。

## 5. CLOSID 与 RMID

理解两个硬件标识：

- CLOSID：Class of Service ID，关联资源分配配置；
- RMID：Resource Monitoring ID，关联监控计数。

线程运行时，硬件根据其关联的 CLOSID 应用 CAT/MBA，根据 RMID 累计 LLC/Memory Bandwidth 指标。

这两类 ID 数量有限。创建大量分组不等于硬件可以无限跟踪，必须读取 `num_closids` 和 `num_rmids`。

## 6. CAT 不是分配固定容量

CAT 使用 Cache Bitmask 指定一组任务可填充哪些 LLC Ways。示意：

```text
LLC Ways: 1111111111111111
Group A : 0000000011111111
Group B : 1111111100000000
```

`schemata` 可能类似：

```text
L3:0=00ff;1=00ff
```

其中 `0`、`1` 通常代表 Cache Domain/Socket，具体含义从 `info` 和拓扑读取。

CAT 的边界：

- Bitmask 限制可使用的 Way，不直接保证若干 MiB 容量；
- Cache Set、替换策略和工作集分布仍影响命中；
- 掩码通常要求连续 Bit，并满足 `min_cbm_bits`；
- 过度切分会让所有任务的 Cache 命中率下降；
- 不同 CPU 的 LLC Slice、Domain 和共享边界不同。

因此不能把 CAT 简化为“给 Pod A 分 20 MB Cache”。

## 7. CMT 与 LLC Occupancy

CMT 可以观测一组任务占用的 LLC 容量。常见监控文件示意：

```text
mon_data/mon_L3_00/llc_occupancy
```

读取值前要确认单位和 Domain：

```bash
cat /sys/fs/resctrl/group-a/mon_data/mon_L3_00/llc_occupancy
```

LLC Occupancy 高只能说明工作集占用多，不能说明命中率高，也不能直接证明它伤害了其他任务。还需比较：

- LLC Miss；
- 业务吞吐/P99；
- CAT 隔离前后；
- 工作集大小和访问模式。

## 8. MBM：监控总带宽与本地带宽

MBM 常见文件：

```text
mbm_total_bytes
mbm_local_bytes
```

它们通常是累计字节，需要用两个采样点计算速率：

```text
带宽 = (后一次计数 - 前一次计数) ÷ 采样间隔
```

`total - local` 可以作为远端流量线索，但实际语义要以平台和 Kernel 文档为准。Counter 可能回绕、复用或受 Errata 影响，采集器必须处理计数变化和异常值。

## 9. MBA：限制不一定等于精确带宽

硬件 MBA 往往通过插入延迟或节流等级降低请求速率。配置值不一定表示精确的 MB/s，也不保证不同工作负载得到相同实际带宽。

Linux `mba_MBps`/Software Controller 模式可以尝试以 MiB/s 为目标进行反馈控制：

```bash
sudo mount -t resctrl resctrl -o mba_MBps /sys/fs/resctrl
```

但它仍受到：

- MBM 测量精度；
- 采样和控制周期；
- CPU 型号与带宽非线性；
- 本地/远端访问；
- 系统其他任务流量；
- Kernel 实现和 Errata。

MBA 是性能隔离工具，不是内存容量限制。内存容量仍由 Cgroup Memory Controller 等机制管理。

## 10. 一个最小监控流程

以下命令展示接口关系，生产执行前应先在测试节点验证：

```bash
sudo mkdir /sys/fs/resctrl/inference
echo $$ | sudo tee /sys/fs/resctrl/inference/tasks
cat /sys/fs/resctrl/inference/schemata
find /sys/fs/resctrl/inference/mon_data -type f -maxdepth 2 -print
```

将 Shell PID 写入 `tasks` 后，新建线程的继承关系、进程迁移和服务重启都需要验证。对长期服务，手工写 PID 不是可靠自动化方案。

## 11. 多租户推理为什么需要这类能力

假设同一 Socket 上运行：

```text
Pod A：vLLM API、Tokenizer、EngineCore
Pod B：数据预处理与压缩任务
```

两者 CPUSet 不重叠，但 Pod B 进行大块流式扫描：

```text
Pod B 内存带宽上升
→ IMC Queue 排队
→ Pod A Tokenizer 与 EngineCore 内存访问延迟上升
→ GPU Step 之间出现空洞
→ GPU Util 下降、TTFT 上升
```

分析顺序：

1. 先用 MBM/IMC 指标证明带宽竞争；
2. 用 CPUSet/NUMA 调整验证局部性；
3. 用 CAT/MBA 做受控实验；
4. 比较业务 SLO 和系统吞吐；
5. 最终决定隔离、迁移还是容量扩展。

不要一看到 P99 抖动就直接限制 Cache Way。

## 12. 与 Cgroup 和 Kubernetes 的边界

| 能力 | 典型机制 |
| --- | --- |
| CPU 时间 | Cgroup CPU quota/weight |
| CPU 放置 | cpuset.cpus |
| NUMA 内存放置 | cpuset.mems、NUMA Policy |
| 内存容量 | Cgroup Memory Controller |
| LLC/内存带宽监控与分配 | resctrl/RDT/QoS |

Kubernetes 的 CPU Manager `static` Policy 可以提供独占 CPU，但不会自动完成 LLC Way 与内存带宽隔离。若要把 `resctrl` 集成到容器平台，还需要：

- 可靠的 Pod/Container PID 到 resctrl Group 映射；
- 节点能力发现与异构调度；
- 分组生命周期和故障清理；
- 与 Runtime、Cgroup 和 CPU Manager 协同；
- Admission、配额和回滚机制。

这不是向 Pod 增加一个普通环境变量就能完成的。

## 13. 安全边界与副作用

- CAT/MBA 会主动改变性能，不能在故障现场盲目修改；
- Root Group 和默认任务可能与业务共享剩余资源；
- 切分不当会降低整机吞吐；
- Counter/ID 是有限资源；
- 不同 Socket 的 Bitmask 和能力可能不同；
- SMT Sibling 仍共享 Core 内部资源，resctrl 不解决执行端口争抢；
- resctrl 也不隔离 PCIe、NIC、NVMe、功耗和温度。

生产环境应先只监控，再通过灰度实验决定是否分配。

## 14. 一套逐步落地方法

```text
阶段 1：盘点 CPU 和 Kernel 能力，只读监控
阶段 2：建立 LLC/MBM 与业务 SLO 基线
阶段 3：复现共享资源干扰
阶段 4：测试 CAT/MBA 的收益和副作用
阶段 5：接入节点标签、调度和生命周期管理
阶段 6：建立回滚、容量与告警边界
```

评价结果时至少同时观察：

- 被保护工作负载的 P50/P99/吞吐；
- 干扰工作负载的性能损失；
- 整机总吞吐；
- LLC Occupancy/Miss；
- Local/Total Memory Bandwidth；
- GPU 空洞和利用率。

## 15. 常见误区

### 15.1 独占 CPU 就不会有噪声邻居

错误。LLC、IMC、Socket Link、I/O、功耗和散热仍然共享。

### 15.2 CAT Mask 等于固定 Cache 容量

错误。它约束可填充的 Way，不提供类似内存配额的字节保证。

### 15.3 MBA=50 就表示 50 GB/s

错误。硬件 MBA 值通常表示节流等级；只有特定 Software Controller 模式才以带宽目标工作，而且仍不是严格保证。

### 15.4 resctrl 可以替代 Cgroup

错误。两者管理的资源和生命周期不同，应组合使用。

## 16. 练习与答案

**问题：两个 Pod 分别使用不同 CPU Core，为什么一个大内存扫描任务仍能影响另一个推理服务？**

答案：它们仍可能共享 LLC、IMC 和 DRAM Channel。扫描任务会驱逐 Cache Line 并占用内存带宽，使推理服务的 Tokenizer、调度与数据准备延迟上升。

**问题：观察到 LLC Occupancy 很高，是否应立即使用 CAT 限制？**

答案：不能。Occupancy 高不等于造成干扰。应结合 LLC Miss、内存带宽、业务 SLO，并通过受控 CAT 实验验证因果关系。

**问题：为什么 `resctrl` 在某台机器上只有监控目录，没有 MBA 或 CAT？**

答案：处理器、BIOS、Kernel 配置和 Driver 暴露的能力不同。RDT/QoS Feature 是正交的，一台机器可能只支持其中一部分。

## 17. 参考资料

- [Linux Kernel：resctrl Filesystem](https://www.kernel.org/doc/html/latest/filesystems/resctrl.html)
- [Intel Performance Counter Monitor](https://github.com/intel/pcm)
- [Intel Resource Director Technology](https://www.intel.com/content/www/us/en/architecture-and-technology/resource-director-technology.html)
