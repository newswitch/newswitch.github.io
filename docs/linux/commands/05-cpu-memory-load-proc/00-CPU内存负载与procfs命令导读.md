---
title: "CPU、内存、负载与 procfs 命令导读"
sidebar_label: "00. CPU、内存、负载与 procfs 命令导读"
sidebar_position: 0
description: "从容量、需求、饱和、消费者、内存压力和历史证据六个维度，系统学习 CPU、内存、负载与 procfs 排障。"
tags: [Linux, CPU, 内存, 负载, procfs, sysstat, 性能排障]
---

# CPU、内存、负载与 procfs 命令导读

“CPU 100%”“内存快满了”“load 很高”都只是现象。真正的排障必须回答：系统有多少资源、谁在提出需求、在哪里排队、内核为何回收、问题发生在当前还是过去、观察范围是宿主机还是容器。

```mermaid
flowchart LR
    A["容量：CPU/内存/限制"] --> B["需求：运行、分配、缺页"]
    B --> C["饱和：run queue/PSI/换页"]
    C --> D["消费者：进程/线程/映射/slab"]
    D --> E["原因：应用/内核/IO/虚拟化"]
    E --> F["历史：sar 与变更时间线"]
```

## 1. 六层证据模型

| 层次 | 核心问题 | 主要证据 |
|---|---|---|
| 容量 | 有多少逻辑 CPU、物理核、RAM、Swap？ | `lscpu`、`nproc`、`free` |
| 需求 | 多少任务要运行，内存如何被使用？ | `top`、`vmstat`、`pidstat` |
| 饱和 | CPU 是否排队，内存是否直接回收/换页？ | `vmstat r/si/so`、`pidstat %wait`、PSI |
| 消费者 | 哪个 PID/TID、映射或 slab 在增长？ | `top -H`、`pidstat`、`pmap`、`slabtop` |
| 约束 | affinity、cgroup、RLIMIT、sysctl 是否改变可用资源？ | `nproc`、`prlimit`、`ulimit`、`sysctl` |
| 历史 | 告警发生时发生了什么？ | `sar` 日文件、监控、日志与变更记录 |

利用率不是饱和度。CPU 利用率低时仍可能因单核热点、锁竞争、配额 throttling 或调度延迟而慢；内存 `free` 很少也可能只是健康的 page cache。

## 2. `/proc` 是动态内核接口

procfs 不是普通磁盘文件系统，读取它得到内核在读取时生成的状态。很多命令只是把这些接口解析、求差并格式化：

| 接口 | 内容 | 对应命令 |
|---|---|---|
| `/proc/uptime`、`/proc/loadavg` | 运行时间、负载、当前 runnable/总任务 | `uptime` |
| `/proc/stat` | CPU jiffies、上下文切换、进程创建等累计计数器 | `top`、`vmstat`、`mpstat`、`sar` |
| `/proc/meminfo` | 物理内存、Swap、cache、slab、HugeTLB | `free` |
| `/proc/vmstat` | 缺页、回收、换页、NUMA 等累计计数器 | `vmstat`、`sar` |
| `/proc/pressure/{cpu,memory,io}` | CPU、内存、IO 停顿时间 | 本导读直接读取，后续性能专栏深入 |
| `/proc/PID/{stat,status,smaps,limits}` | 单进程 CPU、内存映射、限制 | `pidstat`、`pmap`、`prlimit` |
| `/proc/slabinfo` | 内核对象缓存 | `slabtop` |
| `/proc/sys` | 可读写内核参数树 | `sysctl` |

多数“每秒”字段来自两次累计计数器之差：

```text
rate = (counter(t2) - counter(t1)) / (t2 - t1)
```

因此 `vmstat`、`mpstat`、`pidstat`、`sar` 的首份报告可能是“自开机以来平均”，后续才是采样区间。不了解采样窗口，就会把历史平均误判为当前状态。

## 3. 正确理解 load average

Linux load average 近似反映可运行状态 `R` 与不可中断睡眠 `D` 任务数量的指数衰减平均，显示 1、5、15 分钟三个时间常数；它不是 CPU 百分比，也不是简单窗口算术平均，而且没有按 CPU 数量归一化。

- load 高、CPU `id` 低、`vmstat r` 高：更像 CPU 排队。
- load 高、CPU 仍空闲、`vmstat b`/D 状态高：更像块设备、NFS、驱动或内核等待。
- load 仅 1 分钟高：刚发生尖峰；15 分钟也高：问题持续较久。
- load 小于逻辑 CPU 数不保证无延迟；单线程服务可能已打满一个核。

## 4. CPU 拓扑与可用 CPU 不是同一件事

```text
socket → core → hardware thread/logical CPU
```

`lscpu` 描述内核看见的拓扑，`nproc` 回答当前进程可使用的处理单元数量。CPU affinity、cpuset 和 cgroup v2 CPU quota 可能使 `nproc` 小于系统 online CPU 数；虚拟机里的拓扑也不一定等同物理宿主机。容量规划不能只抄 `/proc/cpuinfo` 行数。

## 5. Linux 为什么“使用很多内存”

物理内存会承载匿名页、文件页缓存、共享内存、页表、内核栈、slab 和 HugeTLB。应用需要内存时，内核可先回收部分 page cache/slab；因此优先观察 `MemAvailable`、工作集、回收、major fault、Swap in/out 和 PSI，而不是只看 `MemFree`。

```text
虚拟地址空间 VIRT
├── 尚未驻留或仅保留地址的映射
├── 匿名页：heap/stack
├── 文件映射：程序、共享库、mmap
└── 共享映射
       ↓ 当前驻留部分
物理内存 RSS（含可共享页，不能直接跨进程相加）
```

`free used`、进程 RSS、cgroup memory.current 和宿主机内存不是同一口径；容器 OOM 也可能发生在宿主机仍有大量 available 内存时。

## 6. 命令清单

| 阶段 | 命令 | 学习目标 |
|---|---|---|
| 基线容量 | `uptime`、`nproc`、`lscpu` | 运行时间、负载、可用 CPU 与硬件拓扑 |
| 实时全局 | `top`、`free`、`vmstat` | 任务、CPU 状态、内存口径、队列、换页与 IO |
| CPU/任务采样 | `mpstat`、`pidstat` | 每 CPU、线程、调度等待、缺页、IO 与切换 |
| 历史与计量 | `sar`、`time` | 读取历史活动；量化一次命令的时间与资源 |
| 内存归因 | `pmap`、`slabtop` | 进程地址映射与内核 slab 缓存 |
| 限制与参数 | `prlimit`、`ulimit`、`sysctl` | 查询/设置 RLIMIT 与运行时内核参数 |

`iostat` 已在[存储命令参考库](../../../storage/commands/09-iostat命令详解.md)；`numastat/taskset/chrt` 已在[内核、硬件拓扑与中断命令模块](../08-kernel-hardware-topology/00-内核硬件拓扑与中断命令导读.md)完整讲解，`perf/strace/eBPF` 留给深度性能分析模块。

## 7. 容器里的观察边界

| 现象 | 不能立即得出的结论 |
|---|---|
| `/proc/cpuinfo` 有 64 个 CPU | 容器可使用 64 个 CPU；还要查 cpuset/quota |
| `free` 显示宿主机内存 | Pod 可使用这些内存；还要查 cgroup limit/current/events |
| load average 很高 | 当前容器造成了全部负载 |
| `top` 只见少量 PID | 宿主机只有这些任务；PID namespace 已隔离视图 |
| `sysctl` 可读 | 当前 namespace 可独立修改该参数 |

同一次排障要写明观察点：宿主机、容器、Pod 还是具体 cgroup。不要把不同范围的分子和分母拼在一起计算百分比。

## 8. 推荐排障顺序

```bash
uptime
nproc; lscpu -e=CPU,CORE,SOCKET,NODE,ONLINE
vmstat -w -y 1 10
mpstat -P ALL 1 10
pidstat -u -r -d -w -t 1 10
free -w
cat /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io
```

先保存时间、主机/容器身份、版本和采样窗口，再逐层缩小到 PID/TID。观察命令本身也有开销；高 PID 数、大量 CPU、`pmap -XX`、`sar -A` 和过短间隔都会放大开销与输出量。

## 9. 安全实验

只在测试环境制造负载，记录前、中、后三个阶段。可用一个短生命周期的 CPU 循环和内存分配程序，但必须设置 `timeout`、低优先级和明确上限；共享生产机不要运行不受控的压力工具。

实验至少完成：单线程 CPU 热点、多线程热点、文件缓存增长、匿名内存增长、受限进程 `RLIMIT_NOFILE`、读取 sar 历史。每次都写出“现象 → 假设 → 证据 → 排除项 → 结论”。

## 10. 模块验收标准

- 能解释 load、CPU 利用率、run queue、调度等待和 PSI 的差别。
- 能区分 installed/online/available CPU 与 socket/core/thread。
- 能解释 `free` 每一列，并说明为何 `MemFree` 低不等于 OOM。
- 能从全局采样缩小到 PID/TID，再区分 CPU、缺页、IO 与上下文切换。
- 能区分虚拟地址、RSS、PSS、匿名页、文件页、Swap 与 slab。
- 能从 sar 找回故障窗口，并与日志、发布和监控时间线对齐。
- 能说明 soft/hard RLIMIT、sysctl 持久化顺序与容器 namespace 边界。

## 11. 官方参考 {/* #官方参考 */}

- [Linux procfs 文档](https://docs.kernel.org/filesystems/proc.html)
- [Linux PSI 文档](https://docs.kernel.org/accounting/psi.html)
- [procps-ng 项目](https://gitlab.com/procps-ng/procps)
- [sysstat 项目](https://github.com/sysstat/sysstat)
- [util-linux 项目](https://github.com/util-linux/util-linux)

下一篇：[`uptime` 命令详解](./01-uptime命令详解.md)
