---
title: "perf top 命令详解：实时 CPU 热点、事件与符号观察"
sidebar_label: "07. perf top 命令详解：实时 CPU 热点、事件与符号观察"
sidebar_position: 7
description: "讲清 perf top 的事件、PID/TID/CPU、频率、call graph、符号过滤、实时界面、零样本和生产开销。"
tags: [Linux, perf top, CPU 热点, PMU, 性能分析]
---

# perf top 命令详解：实时 CPU 热点、事件与符号观察

`perf top` 类似对 perf 样本做实时排行榜，适合在故障窗口快速看到 CPU 正执行哪些符号。它的屏幕会持续变化，难以复盘；需要正式证据时改用 `perf record` 保存原始数据。

## 1. 参数

```text
perf top [OPTIONS]
```

| 参数族 | 代表参数 | 含义 |
|---|---|---|
| 事件 | `-e EVENT`、`-F HZ`、`-c COUNT` | 事件、频率或周期 |
| 目标 | `-p PID`、`-t TID`、`-a`、`-C CPU-LIST` | 进程、线程、系统、CPU |
| 栈 | `-g`、`--call-graph METHOD` | 调用图采样 |
| 展示 | `-d SEC`、`-E N`、`-s SYMBOL`、`--sort KEY` | 刷新、条目数、符号/排序 |
| 过滤 | `--comms`、`--dsos`、`--symbols`、`-u USER` | 命令、DSO、符号、用户 |
| 符号 | `-k PATH`、`--vmlinux PATH`、`-m PAGES` | 内核映像与缓冲区 |
| 界面 | `--stdio`、`--tui`、`--no-children` | 输出与累计口径 |

```bash
sudo perf top -F 49 -p 1234 --sort comm,dso,symbol
sudo perf top -e cycles:k -C 0-7
```

## 2. 解读与交互

`Overhead` 是当前窗口样本比例；`Shared Object` 是 DSO/kernel，`Symbol` 是解析后的函数。交互键可切换注释、事件、过滤和刷新，随版本变化，以界面帮助为准。

如果全是 `[unknown]`，检查符号和权限；如果没有样本，检查目标是否真在 CPU 上、事件是否受支持、CPU mask 与 PID 是否匹配、NMI watchdog/虚拟化是否占用 PMU。

## 3. 风险与验收

全系统高频加调用栈会增加中断、栈复制和符号解析开销。先 49/99 Hz、精确 PID/CPU、短时间；不要因为热点列表中某函数居首就直接认定它是业务慢的原因——进程可能主要在 off-CPU 等待。

掌握标准：能从实时热点决定下一次可复现 `perf record` 的事件、范围和时长，并知道何时应转向 `perf sched`/off-CPU 工具。

## 4. 官方参考

- [perf-top(1)](https://man7.org/linux/man-pages/man1/perf-top.1.html)

下一篇：[perf sched/trace 命令详解](./08-perf-sched-trace命令详解.md)。
