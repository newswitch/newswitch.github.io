---
title: irqtop 命令详解：实时定位 IRQ 与 softirq 热点
sidebar_position: 19
description: 完整讲解 irqtop 的全部参数、交互键、DELTA 与 TOTAL、batch/JSON 自动化、CPU 与阈值过滤，以及中断风暴和 NUMA 偏斜诊断。
tags: [Linux, irqtop, IRQ, softirq, 性能分析]
---

# `irqtop` 命令详解：实时定位 IRQ 与 softirq 热点

`irqtop` 以 top 风格周期读取内核中断计数，重点观察窗口内增量。它回答“现在谁在产生中断、落在哪些 CPU”，但不直接测中断 handler 耗时；高计数可能是正常高吞吐，低计数也可能每次处理很慢。

## 1. 语法与全部参数

```text
irqtop [OPTIONS]
```

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-o LIST` | `--output LIST` | 显式选择列；`+LIST` 追加默认列 |
| `-b` | `--batch` | 输出到 stdout 而非刷新固定屏幕 |
| `-c WHEN` | `--cpu-stat WHEN` | per-CPU 列显示策略：`auto|never|always` |
| `-C LIST` | `--cpu-list LIST` | 只显示指定 CPU |
| `-d SEC` | `--delay SEC` | 刷新间隔秒数 |
| `-J` | `--json` | JSON 输出并隐含 `--batch` |
| `-n N` | `--iter N` | 最多刷新 N 次后退出 |
| `-s COLUMN` | `--sort COLUMN` | 指定排序列 |
| `-S` | `--softirq` | 显示 softirq 而非硬中断 |
| `-t MIN` | `--threshold MIN` | 只显示计数高于阈值项，支持 `1.2K` |
| `-h` | `--help` | 帮助并列出支持列 |
| `-V` | `--version` | 显示 util-linux 版本 |

```bash
irqtop -d 1
irqtop -C 0-15 -c always -s DELTA
irqtop -S -d 1
irqtop -b -n 10 -d 1 -o IRQ,DELTA,TOTAL,NAME
```

默认列会变化，脚本始终使用 `--output`。

## 2. 交互键

| 键 | 作用 |
|---|---|
| `i` | 按 IRQ 短名/编号排序 |
| `t` | 按累计 `TOTAL` 排序（默认） |
| `d` | 按窗口 `DELTA` 排序 |
| `n` | 按长描述名称排序 |
| `q` / `Q` | 退出 |

实时排障通常先按 `d`，否则开机以来累计最多的 timer/设备可能掩盖当前突发。

## 3. DELTA、速率与时间窗口

`DELTA` 是相邻采样间计数变化。若 `--delay=2`，delta 是两秒增量，不自动等于每秒速率；比较不同 delay 时要除以间隔。首次样本、IRQ 新建/消失、计数异常重置都需特殊处理。

```bash
irqtop -b -n 6 -d 2 -s DELTA -o IRQ,DELTA,TOTAL,NAME
```

至少观察多个窗口，区分一次 burst、稳定高负载和中断风暴。

## 4. 中断热点不等于 CPU 热点

同时看：

```bash
irqtop -C 0-31 -c always -s DELTA
mpstat -P ALL 1
pidstat -u -w 1
cat /proc/softirqs
```

IRQ count 只统计触发次数。网卡 interrupt moderation 会减少中断但每次处理更多 packet；NAPI 把工作转入 softirq；驱动 thread IRQ 还可能在线程上下文执行。要结合 CPU `%irq/%soft`、softirq、队列 packet/drop、perf/trace 和尾延迟。

## 5. batch 与 JSON 自动采集

```bash
irqtop -b -n 60 -d 1 -o IRQ,DELTA,TOTAL,NAME
irqtop -J -n 10 -d 1 -o IRQ,DELTA,NAME
LIBSMARTCOLS_JSON=lines irqtop -J -n 10 -d 1 -o IRQ,DELTA,NAME
```

`LIBSMARTCOLS_JSON=compact|lines` 控制 JSON 形态（视版本支持）。生产 collector 需设置 `--iter`，否则 batch 会持续运行；还要捕获工具版本、CPU 数和列 schema。

## 6. NIC IRQ 偏斜闭环

```bash
ethtool -l eth0
ethtool -x eth0
irqtop -d 1 -s DELTA
ls -1 /sys/class/net/eth0/device/msi_irqs
grep . /proc/irq/IRQ/effective_affinity_list
```

依次判断：

1. channel/RSS queue 数是否合理；
2. 流量 hash 是否天生单流；
3. vector 与 queue 的驱动命名映射；
4. IRQ CPU 是否在 NIC 本地 NUMA；
5. RPS/XPS 是否又把 packet 移到远端 CPU；
6. 应用线程与内存是否同 locality；
7. 修改前后吞吐、drop、p99 和跨 NUMA 流量是否改善。

## 7. 中断风暴处置

如果某 IRQ 在无合理业务下高速增长：

- 先确认名称、BDF、driver、设备错误和 AER；
- 检查 link flap、firmware reset、队列卡死与共享 legacy IRQ；
- 准备业务迁移和设备隔离，不要直接全局禁 IRQ；
- 保存 `dmesg`、`lspci -vv`、ethtool/devlink/设备健康信息；
- affinity 只能移动负载，不能修复持续产生错误中断的硬件/驱动。

## 8. 官方参考

- [util-linux：irqtop(1)](https://man7.org/linux/man-pages/man1/irqtop.1.html)
- [Linux 内核：SMP IRQ affinity](https://docs.kernel.org/core-api/irq/irq-affinity.html)

下一篇：[lstopo 命令详解](./20-lstopo命令详解.md)。
