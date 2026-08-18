---
title: "pidstat 命令详解：进程线程 CPU、等待、缺页、IO 与切换"
sidebar_label: "08. pidstat 命令详解：进程线程 CPU、等待、缺页、IO 与切换"
sidebar_position: 8
description: "完整讲解 sysstat pidstat 的全部参数、PID/线程筛选、CPU 与调度等待、内存缺页、IO、上下文切换、子进程和 JSON。"
tags: [Linux, pidstat, CPU, 线程, 内存, IO, sysstat]
---

# pidstat 命令详解：进程线程 CPU、等待、缺页、IO 与切换

`pidstat` 把系统级热点归因到 PID/TID，并对采样窗口做差。它能同时观察 CPU、调度等待、page fault、RSS、IO、stack、fd/thread、上下文切换与实时调度策略。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | sysstat 12.7.9 |
| 数据源 | `/proc/PID` 与系统累计计数器 |
| 安全级别 | 观察 `[R]`；`-e` 会执行目标程序 `[W]` |

```text
pidstat [options] [interval [count]]
pidstat [options] interval [count] -e program [args ...]
```

无 interval 时显示自开机累计平均；有 interval 无 count 持续采样。未指定活动类型时默认 `-u`。

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-C REGEX` | command name 匹配正则 |
| `-G REGEX` | process name 匹配正则；配合 `-t` 含其线程 |
| `-d` | task IO 统计 |
| `--dec=0|1|2` | 小数位 |
| `-e PROGRAM ARGS` | 执行并监控程序；要求非零 interval |
| `-H` | 时间戳为 epoch 秒 |
| `-h` | 所有活动横向单行、无末尾 average，便于解析 |
| `--human` | 易读单位，不适合稳定机器解析 |
| `-I` | SMP 下把任务 `%CPU` 除以系统 CPU 数 |
| `-l` | 显示完整 command line，可能泄露秘密 |
| `-o JSON` | JSON 输出，字段顺序不保证且可扩展 |
| `-p PIDLIST|SELF|ALL` | 选择任务；不写时仅展示有非零活动的任务 |
| `-R` | 实时优先级与调度策略 |
| `-r` | page faults 与内存使用 |
| `-s` | stack 保留/引用量 |
| `-T TASK|CHILD|ALL` | 单任务、已回收子进程聚合或两者 |
| `-t` | 展示线程，增加 TGID/TID |
| `-U [USER]` | UID 显示为用户名；带 USER 时只选该用户 |
| `-u` | CPU 与调度等待 |
| `-V` | 版本 |
| `-v` | thread 数与 fd 数等内核表值 |
| `-w` | voluntary/nonvoluntary context switches |

多个活动选项可组合，但经典表格会分成多个报告；`-h` 或 JSON 更便于关联。

## 3. CPU 与 `%wait`

```bash
pidstat -u -t -p 1234 1 10
```

| 字段 | 含义 |
|---|---|
| `%usr/%system/%guest` | 采样区间用户、内核、guest CPU 时间 |
| `%wait` | 任务处于 runnable 但等待 CPU 的时间占比 |
| `%CPU` | 总 CPU；默认单 CPU 口径，`-I` 时除以全部 CPU |
| `CPU` | 最近关联的逻辑 CPU，不代表固定绑定 |

`%wait` 是 CPU 调度等待，不是块 IO wait。高 `%wait` 且系统 `r` 高说明 runnable 竞争；IO 阻塞任务通常睡眠，不在此列累计。

## 4. 内存与缺页

```bash
pidstat -r -p ALL 1 10
```

`minflt/s` 通常无需磁盘 IO，可由首次匿名页分配、COW 或已在 cache 的文件页产生；`majflt/s` 需要从存储装入页，可能造成明显延迟。`VSZ` 是虚拟地址空间，`RSS` 是驻留集合，`%MEM` 是 RSS 占可用物理内存口径。

RSS 不能区分共享页的比例，也不含全部内核/cgroup 费用；进一步使用 `pmap -X/-XX`、`/proc/PID/smaps_rollup` 与应用 profiler。

## 5. IO、切换与资源表

```bash
pidstat -d -w -v -p 1234 1 10
```

- `kB_rd/s`：任务引发的存储读取；cache hit 通常不产生磁盘读取计费。
- `kB_wr/s`：已导致或将导致的写入，受 page cache/writeback 影响。
- `kB_ccwr/s`：截断脏页等取消的写入。
- `iodelay`：同步块 IO 与 swapin 等等待的 clock ticks，不是毫秒。
- `cswch/s`：主动阻塞产生的 voluntary switch。
- `nvcswch/s`：时间片用尽/更高优先级抢占等 involuntary switch。
- `threads/fd-nr`：线程与文件描述符数量。

`-s` 的 `StkSize/StkRef` 是 stack 映射/引用视角，不等于语言 runtime 所有 goroutine/协程栈的精确总量。

## 6. CHILD 统计的时间边界

```bash
pidstat -T ALL -u -r -p 1234 1 10
```

子进程的 CPU/缺页聚合通常只有在 child 退出并被 wait 后才计入，不一定对应当前窗口。它适合编译器/批任务等 fork workload 的累计归因，不适合找仍在运行的某个 child；后者用 `-G/-p/-t` 逐任务观察。

## 7. 执行并计量新程序

```bash
pidstat -u -r -d -w 1 -e -- ./worker --config ./lab.conf
```

确认本机 `--help` 对 `--` 的解析；目标参数可能被 pidstat 当作自身选项时，应使用明确分隔。`-e` 的目标来自可信输入，输出 command line 可能包含密钥。

## 8. 生产定位路径

```bash
mpstat -P ALL 1 5
pidstat -u -r -d -w -t -p ALL 1 10
```

| 证据 | 方向 |
|---|---|
| 单 TID `%usr` 高 | 算法热点，应用 profiler/perf |
| `%system` 高 | syscall/内核路径，strace/perf/eBPF |
| `%wait` 高 | CPU runnable 排队、配额或优先级 |
| `majflt/s` 高 | 文件/匿名页重新装入、内存压力 |
| `kB_wr/s` 高 | 找写入者，再用 iostat 看设备 |
| `nvcswch/s` 高 | CPU 竞争/短时间片/高优先任务 |

进程在扫描中可退出，PID 可复用；长时间采集应同时记录 PID 启动时间/cgroup/command identity。

## 9. 输出环境与解析

`S_COLORS`、`S_COLORS_SGR` 控制颜色，`S_TIME_FORMAT=ISO` 固定时间格式。自动化优先 `-o JSON`，容忍新字段；文本至少固定 `LC_ALL=C`、禁色并使用 `-h`。`--human` 与脚本解析目标相反。

## 10. 退出状态、实验与掌握标准

成功为 `0`，参数/procfs/执行失败为非 `0`。实验：单/多线程 CPU、读写与 page cache、匿名内存、频繁 sleep/锁竞争、fork child；观察 `-I/-t/-T/-h/JSON` 差异。

掌握标准：能列出全部参数，区分 `%wait` 与 IO wait、minor/major fault、RSS/VSZ、voluntary/involuntary switch，并从 PID 缩小到 TID。

## 11. 官方参考 {/* #官方参考 */}

- [sysstat pidstat(1)](https://man7.org/linux/man-pages/man1/pidstat.1.html)
- [Linux proc_pid_io(5)](https://man7.org/linux/man-pages/man5/proc_pid_io.5.html)
- [Linux proc_pid_stat(5)](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html)

上一篇：[`mpstat` 命令详解](./07-mpstat命令详解.md)

下一篇：[`sar` 命令详解](./09-sar命令详解.md)
