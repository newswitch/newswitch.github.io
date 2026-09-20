---
title: "Linux 内存指标与故障排查：从 MemAvailable 到 RSS、PSS、PSI"
sidebar_label: "09. Linux 内存指标与故障排查"
sidebar_position: 9
description: "统一解释 meminfo、vmstat、smaps、cgroup、NUMA 和 PSI 指标，并给出内存问题的分层证据链。"
tags: [Linux, MemAvailable, RSS, PSS, PSI, 内存排障]
---

# Linux 内存指标与故障排查：从 MemAvailable 到 RSS、PSS、PSI

没有一个指标能独立回答“内存是否正常”。容量、占用组成、回收活动、等待压力、限制边界和业务工作集必须在同一时间窗口内联合分析。

## 1. 系统级口径

```bash
free -w
grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapCached|Active|Inactive|AnonPages|Mapped|Shmem|Slab|SReclaimable|SUnreclaim|PageTables|KernelStack|Dirty|Writeback|HugePages|AnonHugePages)' /proc/meminfo
```

关键解释：

- `MemFree`：完全未使用物理页，不等于可供新应用使用的全部内存。
- `MemAvailable`：内核估算在不发生明显 Swap 的情况下可供新工作负载使用的内存，包含可回收部分。
- `Cached`：主要是文件缓存相关口径，不等于所有 Page Cache 的简单精确总量。
- `Shmem`：tmpfs/共享内存等，不能随意当作可丢弃文件缓存。
- `Slab`：内核对象缓存，还要区分可回收和不可回收部分。

`free` 的 `used` 是工具按其他字段计算的展示口径，应确认版本公式，不要与进程 RSS 直接对账。

## 2. 进程级口径

| 指标 | 含义 | 主要限制 |
|---|---|---|
| VSS/VIRT | 虚拟地址范围 | 包含未驻留、文件映射和预留地址 |
| RSS | 当前驻留页 | 共享页在多个进程重复计算 |
| PSS | 共享页按映射者分摊 | 采集更重、关系随时间变化 |
| USS | 进程独占驻留页 | 不代表终止进程后必然精确释放量 |
| Anonymous | 匿名驻留相关口径 | allocator、共享匿名页仍需细分 |

```bash
cat /proc/<PID>/smaps_rollup
pmap -x <PID> | tail -n 5
grep -E 'Vm(Size|RSS|Data|Stk|Swap)|Rss(Anon|File|Shmem)' /proc/<PID>/status
```

## 3. 活动和压力

```bash
vmstat -w -y 1 10
pidstat -r -p ALL 1 10
grep -E 'pgfault|pgmajfault|pgscan|pgsteal|allocstall|pswpin|pswpout|compact' /proc/vmstat
cat /proc/pressure/memory
```

重点不是累计值，而是采样增量：

- `pgmajfault` 快速增长：需要存储支持的缺页增多。
- `pgscan` 很高但 `pgsteal` 很低：回收效率可能较差。
- `allocstall` 增长：分配者进入 Direct Reclaim。
- PSI `some/full` 上升：任务因内存压力发生可量化停顿。
- `si/so` 持续增长：正在换页，而非历史 Swap 占用。

## 4. 五类典型问题

### 4.1 正常使用 Page Cache {/* #正常使用-page-cache */}

`MemFree` 低、`MemAvailable` 高、回收和 PSI 低、业务正常。无需清缓存。

### 4.2 匿名工作集增长 {/* #匿名工作集增长 */}

进程/cgroup anon、RSS/PSS 持续增长，可能是业务缓存、批量峰值、allocator 保留或泄漏。继续进入应用分配剖析。

### 4.3 Page Cache 抖动 {/* #page-cache-抖动 */}

文件页反复被驱逐，Major Fault/磁盘读/回收/PSI 与延迟同步升高。需要降低工作集、增加内存或改变访问模式。

### 4.4 Slab 异常增长 {/* #slab-异常增长 */}

`SUnreclaim` 或特定 slab cache 持续增长。结合 slabtop、对象数量、网络/文件业务和内核版本判断驱动或内核对象泄漏。

### 4.5 cgroup 限制 {/* #cgroup-限制 */}

节点健康，但目标 cgroup `memory.events high/max/oom` 增长。应在该边界分析 anon/file/kernel 和工作集，而不是看节点总量。

## 5. 一套排查命令

```bash
date -Ins
free -w
vmstat -w -y 1 10
cat /proc/pressure/memory
ps -e -o pid,ppid,rss,vsz,stat,comm --sort=-rss | head -20
grep -E 'Slab|SReclaimable|SUnreclaim|PageTables|KernelStack|Dirty|Writeback' /proc/meminfo
slabtop -o -s c
numastat
```

若目标在容器中，再读取目标 cgroup 的 `memory.current/stat/events/pressure`。不要混用不同时间点和不同 Namespace 的数字。

## 6. 案例：利用率不满但 P99 升高

现象：内存使用 82%，CPU 40%，接口 P99 每隔几十秒升高。

分析：

1. `MemAvailable` 仍有余量，不能仅凭 82% 判断不足。
2. `allocstall` 和 memory PSI `full` 在尖峰窗口增长。
3. 目标 cgroup `memory.events high` 增长，但没有 oom。
4. 服务超过 `memory.high` 后进入同步回收，线程停顿。
5. 根因是 cgroup 高水位与工作集不匹配，不是 CPU 或磁盘平均利用率。

## 7. 不应默认执行的“修复”

- 不经分析执行 `drop_caches`。
- 为避免 OOM 把所有进程 `oom_score_adj` 设为 -1000。
- 看到 Swap Used 就关闭 Swap。
- 只调大 Pod limit，不修复无界缓存或泄漏。
- 只看 RSS 相加推导节点内存。
- 在生产上用无上限压力程序复现。

## 8. 练习与答案

**问题：`free` 显示 available 很高，但某次高阶内存分配失败，矛盾吗？**

答案：不矛盾。available 估算总体可用容量，不保证指定 Node/Zone、连续阶、分配标志和当前上下文能满足请求。

**问题：如何区分当前 Swap 抖动和历史冷页？**

答案：观察一段时间内 `vmstat si/so`、`pswpin/pswpout`、major fault、回收和 PSI 增量，并与延迟对齐；仅看 Swap Used 无法区分。

下一步：返回 [Linux 系统原理学习路线](../00-Linux系统原理学习路线.md)
