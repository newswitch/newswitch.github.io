---
title: "lsirq 命令详解：结构化分析硬中断、softirq 与 CPU 分布"
sidebar_label: "18. lsirq 命令详解：结构化分析硬中断、softirq 与 CPU 分布"
sidebar_position: 18
description: "完整讲解 lsirq 的全部参数、硬中断与 softirq、累计计数与采样差值、CPU 列筛选、JSON/键值输出，以及 GPU/NIC/NVMe IRQ 不均衡排查。"
tags: [Linux, lsirq, IRQ, softirq, 性能分析]
---

# lsirq 命令详解：结构化分析硬中断、softirq 与 CPU 分布

`lsirq` 是 util-linux 对 `/proc/interrupts` 与 `/proc/softirqs` 的结构化展示工具。它适合做单次快照、排序、过滤和机器输出；要连续观察变化用 `irqtop`。

## 1. 语法与全部参数

```text
lsirq [OPTIONS]
```

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-n` | `--noheadings` | 不显示表头 |
| `-i FILE` | `--input FILE` | 从 sosreport 等保存的 interrupts 文件读取，便于离线分析 |
| `-o LIST` | `--output LIST` | 显式选择列；`+LIST` 在默认列后追加 |
| `-s COLUMN` | `--sort COLUMN` | 按指定列排序 |
| `-J` | `--json` | JSON 输出 |
| `-P` | `--pairs` | `key="value"` 输出，危险字符十六进制转义 |
| `-S` | `--softirq` | 改为显示 softirq 计数 |
| `-t MIN` | `--threshold MIN` | 只显示计数高于阈值的项，支持 `1.2K` 等人类值 |
| `-C LIST` | `--cpu-list LIST` | 只显示指定 CPU 列 |
| `-h` | `--help` | 帮助并列出本版本可用 column |
| `-V` | `--version` | 显示 util-linux 版本 |

```bash
lsirq
lsirq -C 0-7 -s TOTAL
lsirq --output IRQ,TOTAL,NAME
lsirq --softirq
```

列名随版本演进，自动化必须先用 `lsirq --help` 核对，并显式 `--output`，不要解析默认列。

## 2. 硬中断和 softirq

```bash
lsirq
lsirq -S
```

- hard IRQ：设备/MSI-X、定时器、IPI 等进入中断处理的计数；
- softirq：内核延后执行的网络收发、timer、RCU、block 等类别；
- NIC 一个 queue 通常对应 MSI-X vector，但名称与队列对应由驱动决定；
- hard IRQ 在某 CPU 不高，不代表网络处理不在该 CPU；还要看 NET_RX softirq、NAPI、RPS/XPS 和 ksoftirqd。

## 3. 累计量不等于速率

`/proc/interrupts` 计数自启动或 vector 建立以来累计。`lsirq` 本身是单次快照，不计算采样 delta；比较负载必须保存两次输出自行做差，或改用 `irqtop`：

```bash
lsirq -o IRQ,TOTAL,NAME
sleep 10
lsirq -o IRQ,TOTAL,NAME
```

跨两次独立进程时最好保存结构化快照并按 IRQ 与 NAME 共同匹配。设备 reset、驱动 reload 与 vector 重建会让 IRQ number 变化，不能只按数字长期关联。

## 4. 看 CPU 分布前先看拓扑

```bash
lsirq -C 0-15
lscpu -e=CPU,NODE,SOCKET,CORE
cat /sys/class/net/eth0/device/numa_node
grep . /proc/irq/IRQ/effective_affinity_list
```

判断“不均衡”不能只看每 CPU 计数相同与否：

- 队列 RSS hash 的业务流量本来可能偏斜；
- NUMA locality 可能比全机平均更重要；
- housekeeping/isolated CPU 有意承担不同角色；
- `irqbalance` 会动态修改 affinity；
- managed IRQ 的 affinity 可能由内核/驱动限制，写入 requested mask 不一定等于 effective mask。

## 5. JSON 和 pairs

```bash
lsirq -J -o IRQ,TOTAL,NAME
lsirq -P -n -o IRQ,TOTAL,NAME
LIBSMARTCOLS_JSON=lines lsirq -J -o IRQ,TOTAL,NAME
```

JSON 布局由 libsmartcols 和列选择决定，升级前做 schema 测试。`LIBSMARTCOLS_JSON=compact|lines` 可控制紧凑 JSON 或 JSON Lines（取决于 util-linux 版本）。

## 6. GPU、NIC、NVMe 排障顺序

```bash
lspci -Dnnk
grep -iE 'mlx|eth|nvme|nvidia|amdgpu' /proc/interrupts
lsirq -s TOTAL
lsirq -S
cat /proc/irq/IRQ/effective_affinity_list
```

1. 从 BDF/driver 找设备；
2. 从 IRQ 名称和 `/sys/bus/pci/devices/BDF/msi_irqs` 找 vector；
3. 看计数增量和 CPU 分布；
4. 对照 CPU/node 与设备 locality；
5. 再看队列、RSS/RPS/XPS、irqbalance、应用线程和 p99；
6. 改 affinity 后验证 `effective_affinity_list` 与业务指标。

## 7. 离线分析

```bash
lsirq --input ./proc-interrupts.txt -o IRQ,TOTAL,NAME
```

`--input` 主要针对符合 `/proc/interrupts` 格式的采集文件，不是任意 CSV/JSON。sosreport 中同时保存 CPU online 状态、NUMA、驱动和设备信息，才能正确解释历史快照。

## 8. 官方参考

- [util-linux：lsirq(1)](https://man7.org/linux/man-pages/man1/lsirq.1.html)
- [Linux 内核：SMP IRQ affinity](https://docs.kernel.org/core-api/irq/irq-affinity.html)

下一篇：[irqtop 命令详解](./19-irqtop命令详解.md)。
