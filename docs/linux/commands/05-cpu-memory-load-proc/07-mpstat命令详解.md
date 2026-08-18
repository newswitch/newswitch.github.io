---
title: "mpstat 命令详解：逐 CPU、NUMA、拓扑与中断采样"
sidebar_label: "07. mpstat 命令详解：逐 CPU、NUMA、拓扑与中断采样"
sidebar_position: 7
description: "完整讲解 sysstat mpstat 的全部参数、逐 CPU 利用率、NUMA 节点、拓扑、硬中断/软中断、JSON 与采样窗口。"
tags: [Linux, mpstat, CPU, NUMA, interrupt, sysstat]
---

# mpstat 命令详解：逐 CPU、NUMA、拓扑与中断采样

系统平均 CPU 可能掩盖单核热点、IRQ 集中和 NUMA 不均衡。`mpstat` 对 `/proc/stat`、interrupts 和 topology 做差分，按 CPU/node 展示利用率与中断。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | sysstat 12.7.9 |
| 数据源 | `/proc/stat`、`/proc/interrupts`、`/proc/softirqs`、sysfs |
| 安全级别 | `[R]` |

```text
mpstat [options] [interval [count]]
```

无 interval 或 interval=0 时报告自开机以来平均；有 interval 无 count 则持续采样。

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-A` | 等价 `-n -u -I ALL`，未显式指定时还隐含 `-N ALL -P ALL` |
| `--dec=0|1|2` | 小数位数 |
| `-H` | 检测并显示物理热插拔 vCPU |
| `-I CPU|SCPU|SUM|ALL` | 逐硬中断、逐软中断、每 CPU 中断总数或全部 |
| `-N NODE_LIST|ALL` | 选择 NUMA nodes |
| `-n` | 按 NUMA node 汇总 CPU 利用率 |
| `-o JSON` | JSON 输出，字段顺序不保证且未来可新增字段 |
| `-P CPU_LIST|ALL` | 选择逻辑 CPU，支持列表与范围 |
| `-T` | CPU 报告增加 CORE/SOCK/NODE 拓扑列 |
| `-U` | 时间戳显示 UTC epoch 秒 |
| `-u` | CPU utilization，默认报告 |
| `-V` | 版本 |

本机 `mpstat --help` 是最终参数基线；旧版发行版可能没有 `-U` 或新 PSI/拓扑能力。

## 3. CPU 字段

| 字段 | 含义 |
|---|---|
| `%usr/%nice` | 用户态普通/nice 时间 |
| `%sys` | 内核态，不含硬/软中断 |
| `%iowait` | 有 outstanding disk IO 时 CPU 的 idle 时间 |
| `%irq/%soft` | 硬中断/软中断处理时间 |
| `%steal` | hypervisor 未调度该 vCPU 的时间 |
| `%guest/%gnice` | guest/niced guest 时间 |
| `%idle` | 无 outstanding disk IO 的 idle |

```bash
mpstat -P ALL -T 1 10
```

看 `all` 后必须看逐 CPU：总体 12.5% 可能是 8 CPU 中一个核 100%。`CPU` 是逻辑 CPU；`-T` 帮助识别同 core 的 SMT siblings。

## 4. 中断与软中断

```bash
mpstat -I SUM -P ALL 1 10
mpstat -I CPU -P ALL 1 5
mpstat -I SCPU -P ALL 1 5
```

`CPU` 源于 `/proc/interrupts` 的单个硬中断，`SCPU` 源于 `/proc/softirqs`，`SUM` 是总中断速率。多队列网卡通常希望 IRQ/RPS 分布合理；单 CPU `irq/soft` 过高可造成网络尾延迟和业务线程被挤压。

不要只因分布“不平均”就改 affinity：NIC queue、RSS hash、NUMA locality、isolated CPU、应用绑核和 irqbalance 策略共同决定合理布局。

## 5. NUMA 与热插拔

```bash
mpstat -n -N ALL 1 10
mpstat -H -P ALL 1 5
```

`-n/-N` 是 CPU 时间按 node 汇总，不是 NUMA memory locality 统计；内存 local/remote、migration 和带宽应再用 `numastat`、perf/厂商工具。热插拔期间 CPU 集合变化，自动解析要按 CPU ID 而非固定行号。

## 6. JSON、locale 与环境

```bash
S_COLORS=never S_TIME_FORMAT=ISO mpstat -o JSON -P ALL 1 5
```

`S_COLORS` 控制颜色，`S_COLORS_SGR` 控制样式，`S_TIME_FORMAT=ISO` 固定日期/时间格式。JSON 字段顺序未定义，未来可加字段；消费者必须按 key 解析并容忍扩展。

## 7. 生产排障

| 现象 | 假设 | 下一步 |
|---|---|---|
| 一个 CPU `%usr` 100% | 单线程热点/affinity | `pidstat -t`、perf/app profiler |
| 一个 CPU `%soft` 高 | 网络 softirq 集中 | `-I SCPU`、网卡队列/RPS/丢包 |
| 多 vCPU `%steal` 高 | 宿主争用 | 云平台/虚拟化宿主 |
| 一个 node 忙、另一个空闲 | NUMA/绑核/调度不均 | cpuset、numastat、应用并行策略 |
| `%iowait` 高 | CPU idle 且有 IO 未完成 | `iostat -x`，不能只据此定磁盘瓶颈 |

## 8. 退出状态、实验与掌握标准

成功为 `0`，参数/procfs 失败为非 `0`。实验：制造单线程热点、多线程热点；比较 `all` 与 `-P ALL`；画出 CORE/SOCK/NODE；采样 interrupts；验证首份与后续报告、JSON schema。

掌握标准：能解释全部参数与 CPU 字段，识别单核/SMT/NUMA/IRQ/steal 问题，并知道 `mpstat` 不能归因到具体 PID 和 NUMA 内存。

## 9. 官方参考 {/* #官方参考 */}

- [sysstat mpstat(1)](https://man7.org/linux/man-pages/man1/mpstat.1.html)
- [Linux SMP IRQ affinity](https://docs.kernel.org/core-api/irq/irq-affinity.html)
- [sysstat 项目](https://github.com/sysstat/sysstat)

上一篇：[`vmstat` 命令详解](./06-vmstat命令详解.md)

下一篇：[`pidstat` 命令详解](./08-pidstat命令详解.md)
