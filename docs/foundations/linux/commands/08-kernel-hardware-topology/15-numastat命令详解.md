---
title: numastat 命令详解：验证 NUMA 命中、远端分配与进程驻留页
sidebar_position: 15
description: 完整讲解 numastat 的全部参数、numa_hit/miss/foreign/local/other 指标、per-node meminfo、进程驻留页、采样差值和 NUMA 优化验证。
tags: [Linux, numastat, NUMA, 内存性能, 性能分析]
---

# `numastat` 命令详解：验证 NUMA 命中、远端分配与进程驻留页

`numastat` 展示每个 NUMA node 的分配统计和进程 resident pages 分布。它用于验证“页实际上在哪里”，而不是设置 policy；设置用 `numactl`，进程 CPU affinity 用 `taskset`。

## 1. 语法与全部参数

```text
numastat
numastat [OPTIONS] [PID|PATTERN...]
```

| 参数 | 含义 |
|---|---|
| `-c` | 压缩表格宽度并把数值四舍五入到 MB，适合多 node 终端 |
| `-m` | 显示类似 `/proc/meminfo` 的 per-node 内存分类 |
| `-n` | 显示经典 NUMA allocator 统计，但用 MB 和新布局 |
| `-p PID|PATTERN` | 显示匹配进程的 per-node resident memory；`-p` 可省，余下参数也按 PID/命令行片段处理 |
| `-s[NODE]` | 按 total 或紧跟其后的 node 降序；例如 `-s2`，中间不能有空格 |
| `-v` | 多进程时逐进程显示详细行，而非主要显示总计 |
| `-V` | 显示版本并退出 |
| `-z` | 隐藏全零行/列；因显示舍入仍可能看到 0.00 |

只给 `numastat` 时为兼容旧工具，单位是 pages；加选项后通常改为 MB，不要混着做数值比较。

## 2. 六个经典指标

| 指标 | 含义 |
|---|---|
| `numa_hit` | 本来就希望在该 node，且成功在该 node 分配 |
| `numa_miss` | 页分配到了该 node，但 policy 原希望别的 node |
| `numa_foreign` | 原希望在该 node，却实际分配到其他 node；全局与 miss 对应 |
| `interleave_hit` | 交错 policy 在目标 node 成功分配 |
| `local_node` | 分配发生时，任务运行 node 与页面 node 相同 |
| `other_node` | 分配时任务运行在其他 node |

这些是自启动以来的**累计分配事件**，不是“当前远端访问次数”或“当前延迟”。`numa_miss` 高也可能是历史启动阶段，需采样增量。

## 3. 用差值而非绝对累计量

```bash
numastat -n
sleep 10
numastat -n
```

严谨实验应在负载窗口前后采集原始 node 文件并做差：

```bash
grep . /sys/devices/system/node/node*/numastat
```

同时记录 CPU affinity、memory policy、负载阶段和内存压力，否则 miss 增量没有可解释上下文。

## 4. 查看进程实际驻留

```bash
numastat -p 1234
numastat -p qemu
numastat -v -p worker
numastat -z -s1 -p 1234
```

pattern 是对进程命令行做片段匹配，可能命中多个实例；自动化优先已校验 PID，并防止 PID 重用。输出按 `Huge`、`Heap`、`Stack`、`Private` 等映射类别汇总 resident pages；文件映射和共享页的归属解释需结合：

```bash
head -n 30 /proc/1234/numa_maps
grep -E 'Cpus_allowed_list|Mems_allowed_list' /proc/1234/status
```

## 5. `-m`：看每个 node 的容量压力

```bash
numastat -m -z
```

重点观察 `MemFree`、`Active/Inactive`、`FilePages`、`AnonPages`、`Slab`、`PageTables`、HugePages 等，但可用字段随内核变化。node 空闲很低不必然是坏事，page cache 可回收；应与 PSI、swap、reclaim、OOM 和业务延迟一起判断。

## 6. GPU/NIC 数据路径验证

```bash
pid=PID
numastat -p "$pid"
taskset -pc "$pid"
cat /sys/bus/pci/devices/0000:3b:00.0/numa_node  # GPU/NIC BDF
lstopo --of console
```

理想状态通常是工作线程 CPU、host pinned/pageable memory 与数据路径设备 locality 合理，但还要看：

- 多线程是否都在 allowed CPU；
- memory 是初始化时 first-touch 还是显式 policy；
- NIC IRQ/RPS/XPS 在哪里；
- GPU peer/DMA 经过哪个 root complex/IOMMU；
- 内存容量是否迫使回退。

## 7. 不要用它证明远端访问性能

`numastat` 看分配位置，不直接测 CPU cache miss、UPI/Infinity Fabric 流量或内存访问延迟。需要结合 `perf` uncore/厂商 PMU、`numa_maps`、内存带宽测试和应用 p99。

## 8. 官方参考

- [numactl：numastat(8)](https://man7.org/linux/man-pages/man8/numastat.8.html)
- [Linux 内核：NUMA memory policy](https://docs.kernel.org/admin-guide/mm/numa_memory_policy.html)

下一篇：[taskset 命令详解](./16-taskset命令详解.md)。
