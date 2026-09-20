---
title: "cgroup 内存与 OOM：宿主机有空闲内存，容器为什么仍会被杀"
sidebar_label: "08. cgroup 内存与 OOM"
sidebar_position: 8
description: "解释 cgroup v2 内存记账、memory.high/max、回收、memcg OOM、全局 OOM 和 Kubernetes 内存限制。"
tags: [Linux, cgroup v2, OOM, Kubernetes, Memory Limit]
---

# cgroup 内存与 OOM：宿主机有空闲内存，容器为什么仍会被杀

cgroup 为一组进程建立独立内存记账和限制。达到该组 `memory.max` 时，即使宿主机仍有大量可用内存，也可能在这个 cgroup 内回收并触发 memcg OOM。

## 1. cgroup v2 主要接口

| 文件 | 含义 |
|---|---|
| `memory.current` | 当前记账使用量 |
| `memory.max` | 硬上限，`max` 表示不设此限制 |
| `memory.high` | 高水位，超过后对分配者施加回收压力 |
| `memory.low` / `memory.min` | 可回收保护语义 |
| `memory.stat` | anon、file、kernel、slab、fault 等分类 |
| `memory.events` | low/high/max/oom/oom_kill 事件累计 |
| `memory.pressure` | 该 cgroup 内存等待压力 |
| `memory.swap.max` | Swap 使用限制 |

实际可用接口取决于内核、挂载模式和委托权限。

## 2. 内存记账不只 RSS

memcg 通常记账匿名内存、文件页、共享内存、部分内核内存和 slab 等。Kubernetes 指标中的 working set、RSS 和 cgroup `memory.current` 不是同一口径。

```bash
cat /proc/<PID>/cgroup
cat /sys/fs/cgroup/<path>/memory.current
cat /sys/fs/cgroup/<path>/memory.stat
cat /sys/fs/cgroup/<path>/memory.events
cat /sys/fs/cgroup/<path>/memory.pressure
```

## 3. 达到限制时发生什么

```text
进程触发内存分配
→ 对所属 cgroup 记账
→ 接近/超过 memory.high：同步回收和节流压力
→ 无法保持在 memory.max 下
→ cgroup 内 OOM 选择牺牲任务
→ memory.events 中 oom/oom_kill 增长
```

这条路径独立于宿主机是否达到全局 OOM。容器看到 OOMKilled 时，应先确认是 memcg OOM、节点全局 OOM、应用主动退出还是设备显存 OOM。

## 4. 全局 OOM 与 memcg OOM

| 类型 | 触发边界 | 主要证据 |
|---|---|---|
| memcg OOM | 某 cgroup 无法在限制内完成分配 | 该 cgroup `memory.events`、内核日志 |
| 全局 OOM | 系统/Node/Zone 无法满足分配 | 全局内核日志、`/proc/vmstat`、系统压力 |
| GPU/NPU OOM | 设备内存分配失败 | 框架和驱动日志、设备指标 |
| 应用分配失败 | allocator/运行时主动返回错误或受 RLIMIT | 应用日志、errno、限制 |

四者处理方式不同，不能都归结为“加大 Pod 内存”。

## 5. OOM Killer 怎样选目标

内核根据候选任务的内存占用、`oom_score_adj`、约束域和保护规则计算牺牲对象。分数是选择机制，不是业务价值判断。`oom_score_adj=-1000` 可强保护进程，但滥用会让系统没有可杀目标。

```bash
cat /proc/<PID>/oom_score
cat /proc/<PID>/oom_score_adj
journalctl -k | grep -i -E 'out of memory|oom-kill|killed process'
```

Kubernetes QoS 和 kubelet 行为会影响资源治理，但内核最终仍按 cgroup 和任务规则执行分配与 OOM。

## 6. 为什么限制边缘会先变慢

在 OOM 之前，任务可能长期进行 cgroup reclaim：扫描文件页、回写、换页或等待。业务先表现为尾延迟和吞吐下降，最后才 OOM。只告警 `memory.current / memory.max` 百分比会漏掉工作集抖动，应同时看 `memory.events high`、fault、reclaim 和 PSI。

## 7. Kubernetes 排查顺序

```text
Pod 状态/退出码
→ 容器前一次日志
→ 节点内核日志
→ Pod 对应 cgroup memory.events/stat/pressure
→ requests/limits/QoS
→ 进程 RSS/PSS、Page Cache、共享内存、Pinned Memory
→ 同期节点全局回收和 OOM
```

Pod 已重建后旧 cgroup 可能消失，因此需要监控系统提前采集累计事件和内核日志。

## 8. 练习与答案

**问题：节点 `MemAvailable` 还有 200GiB，Pod 为什么 OOMKilled？**

答案：Pod 所属 cgroup 可能达到 `memory.max`。cgroup 是独立约束边界，不允许它任意使用节点剩余内存。

**问题：`memory.current` 高是否都能通过 drop cache 解决？**

答案：不能。占用可能是匿名内存、共享内存、内核内存或不可回收工作集。全局 drop cache 还会伤害其他业务且不能修复泄漏，应先看 `memory.stat` 和压力证据。

下一篇：[Linux 内存指标与故障排查](./09-Linux内存指标与故障排查.md)
