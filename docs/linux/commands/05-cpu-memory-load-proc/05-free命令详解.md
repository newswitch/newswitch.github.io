---
title: "free 命令详解：MemAvailable、缓存、Swap 与内存承诺"
sidebar_label: "05. free 命令详解：MemAvailable、缓存、Swap 与内存承诺"
sidebar_position: 5
description: "完整讲解 procps-ng free 的全部参数、内存字段、缓存与可回收内存、Swap、commit、容器边界和 OOM 排障。"
tags: [Linux, free, 内存, Swap, MemAvailable, procps-ng]
---

# free 命令详解：MemAvailable、缓存、Swap 与内存承诺

`free` 解析 `/proc/meminfo`，展示系统物理内存与 Swap 的容量和当前口径。最重要的不是 `free` 列，而是 `available`、内存压力、回收/换页速率与 cgroup 限制。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | procps-ng 4.0.6 |
| 数据源 | `/proc/meminfo` |
| 安全级别 | `[R]` |

```text
free [option ...]
```

```bash
free --version
free --help
```

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-b, --bytes` | bytes |
| `-k, --kibi` | KiB，默认 |
| `-m, --mebi` | MiB |
| `-g, --gibi` | GiB |
| `--tebi`、`--pebi` | TiB、PiB |
| `--kilo`、`--mega`、`--giga`、`--tera`、`--peta` | 十进制单位，并隐含 `--si` |
| `-h, --human` | 自动选择二进制易读单位 |
| `--si` | 以 1000 而非 1024 为单位进位 |
| `-w, --wide` | 分开 `buffers` 与 `cache` 列 |
| `-l, --lohi` | 显示 low/high memory；现代平台通常价值有限 |
| `-L, --line` | 单行输出，适合连续显示 |
| `-s, --seconds=DELAY` | 按 DELAY 秒持续刷新，支持小数 |
| `-c, --count=N` | 配合 `-s` 输出 N 次 |
| `-t, --total` | 增加 RAM+Swap 合计行；不代表可互换资源池 |
| `-v, --committed` | 显示 commit limit、committed 与未承诺量 |
| 无，`--help` | 帮助 |
| `-V, --version` | 版本 |

## 3. 每一列如何计算

| 列 | 核心含义 |
|---|---|
| `total` | `MemTotal` / `SwapTotal`，可用总量而非 DIMM 标称容量 |
| `used` | 物理内存近似 `total - available`；版本间算法有过变化 |
| `free` | 完全未使用的 `MemFree` / `SwapFree` |
| `shared` | 主要来自 `Shmem`，常含 tmpfs |
| `buffers` | 内核块设备缓冲 `Buffers` |
| `cache` | page cache 加可回收 slab 等口径 |
| `buff/cache` | buffers 与 cache 合计 |
| `available` | 无明显 swapping 时可给新应用的估算 `MemAvailable` |

`available` 会考虑 page cache 可回收部分和并非所有 slab 都能回收，因此不等于 `free + cache`。旧内核缺少 `MemAvailable` 时工具会估算，极旧内核可能退化为 free。

## 4. 正确理解缓存

Linux 用空闲 RAM 缓存文件与内核对象，提升 IO 性能。`free` 很低而 `available` 充足、PSI 低、没有直接回收和 Swap IO，通常是健康状态。

```bash
free -w
grep -E '^(MemAvailable|Cached|SReclaimable|SUnreclaim|Dirty|Writeback|AnonPages|Shmem):' /proc/meminfo
vmstat -w -y 1 10
cat /proc/pressure/memory
```

不能为了“让 free 变大”在生产中随意 drop_caches；它会破坏热缓存、制造 IO 峰值且不能修复内存泄漏。

## 5. Swap 使用与换页活动

Swap used 非零不等于正在抖动。冷匿名页可能长期留在 Swap，即使当前有可用 RAM；真正的现场证据是 `vmstat si/so`、`sar -W`、major fault、PSI 和延迟。

```bash
free -h
vmstat -w -y 1 10
sar -W 1 10
```

没有 Swap 也不代表不会 OOM；内存压力下内核缺少匿名页后备空间，可能更快进入回收/OOM。

## 6. committed 与 overcommit

```bash
free -v
sysctl vm.overcommit_memory vm.overcommit_ratio
grep -E '^(CommitLimit|Committed_AS):' /proc/meminfo
```

`Committed_AS` 是内核对虚拟内存承诺的估算，不是当前 RSS；`CommitLimit` 取决于 overcommit 策略、RAM、Swap、ratio/kbytes。策略允许 overcommit 时，commit 超过 100% 不等于已经 OOM，但代表“所有承诺同时兑现”不可行。

## 7. 容器与 cgroup

容器内 `/proc/meminfo` 可能展示宿主机口径，实际限制则在 cgroup：

```bash
cat /sys/fs/cgroup/memory.current 2>/dev/null
cat /sys/fs/cgroup/memory.max 2>/dev/null
cat /sys/fs/cgroup/memory.events 2>/dev/null
cat /sys/fs/cgroup/memory.pressure 2>/dev/null
```

Pod 因 `memory.max` OOM 时，宿主机 `free` 完全可能很充足。共享 page cache 的 cgroup 计费也不能用宿主机 `free` 直接归因到单进程。

## 8. 连续观察与脚本

```bash
free -w -s 1 -c 10
free -L -s 0.5 -c 20
```

默认文本受版本、locale 和单位影响；机器采集优先 `/proc/meminfo`、cgroup 文件或 exporter。若必须解析，固定单位和字段名，不解析 `-h`。

## 9. 常见误判

| 误判 | 修正 |
|---|---|
| used 接近 total 就是泄漏 | 看 available、匿名内存、slab、压力与趋势 |
| buff/cache 都能瞬间释放 | 部分页在用/脏写回，slab 也有不可回收部分 |
| Swap used > 0 就是故障 | 看当前 `si/so` 与延迟 |
| `-t` 是总可用内存 | RAM 与 Swap 性能、语义不同 |
| 进程 RSS 之和应等于 used | 共享页会重复计数，内核内存也不在普通 RSS 中 |

## 10. 退出状态、实验与掌握标准

成功为 `0`，参数或读取 procfs 失败为非 `0`。实验：比较所有单位；制造文件 cache 与匿名内存增长；观察 free/available/AnonPages/Cached/PSI；在 cgroup 受限容器中比较宿主与容器。

掌握标准：能解释全部参数与列、cache/Swap/commit/cgroup 口径，能用速率和压力证据判断内存是否真正饱和。

## 11. 官方参考 {/* #官方参考 */}

- [procps-ng free(1)](https://man7.org/linux/man-pages/man1/free.1.html)
- [Linux `/proc/meminfo`](https://docs.kernel.org/filesystems/proc.html#meminfo)
- [Linux cgroup v2 memory controller](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory)

上一篇：[`top` 命令详解](./04-top命令详解.md)

下一篇：[`vmstat` 命令详解](./06-vmstat命令详解.md)
