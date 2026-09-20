---
title: "内存回收、Swap 与抖动：Linux 如何在压力下腾出物理页"
sidebar_label: "05. 内存回收、Swap 与抖动"
sidebar_position: 5
description: "解释水位、kswapd、Direct Reclaim、文件页与匿名页、脏页回写、Swap 和 Thrashing。"
tags: [Linux, Reclaim, Swap, kswapd, PSI]
---

# 内存回收、Swap 与抖动：Linux 如何在压力下腾出物理页

Linux 不会等物理内存完全耗尽才回收。各 Zone 有水位，后台 `kswapd` 在压力上升时回收；分配路径无法及时获得页面时，任务可能进入 Direct Reclaim，直接把回收延迟叠加到业务请求上。

## 1. 哪些页面能回收

| 页面类型 | 无 Swap 时 | 有 Swap 时 |
|---|---|---|
| 干净文件页 | 可丢弃，需要时重新读文件 | 同左 |
| 脏文件页 | 先回写再回收 | 同左 |
| 匿名页 | 通常无法直接丢弃 | 可换出到 Swap |
| mlock/Unevictable | 通常不可回收 | 受锁定语义约束 |
| slab | 部分通过 shrinker 回收 | 与 Swap 无直接等价关系 |

Swap 为匿名页提供后备存储，也能保留更多文件缓存，但 Swap 很慢时会放大延迟。关闭 Swap 并不会消除内存压力，只会减少一个回收选择。

## 2. 后台回收与直接回收

```text
空闲页下降到 low watermark
→ 唤醒 kswapd 后台回收
→ 尝试恢复到较高水位

分配请求仍无法满足
→ 当前业务线程进入 Direct Reclaim
→ 扫描 LRU、回写或等待
→ 请求长尾增加
```

CPU 使用率可能不高，存储平均延迟也可能看似正常，但少量请求卡在 Direct Reclaim，造成 P99/P999 突增。

## 3. 活跃、非活跃与工作集

内核使用访问历史近似判断哪些页更值得保留。现代内核可能使用传统 active/inactive LRU 或启用 Multi-Gen LRU 等实现。核心目标相同：在不知道未来访问的情况下，优先回收不太可能再次使用的页。

一次性扫描大文件会污染缓存；工作集略大于可用内存时，页面可能刚被驱逐又很快读回，形成抖动。

## 4. Swap-in/out 与压力

```bash
vmstat -w 1
grep -E 'pswpin|pswpout|pgscan|pgsteal|allocstall' /proc/vmstat
cat /proc/pressure/memory
```

`vmstat si/so` 是采样窗口内换入/换出速率，不是 Swap 已用容量。Swap 使用不为零不等于当前正在抖动；历史冷页可能长期留在 Swap。真正危险的是持续换入换出、回收扫描、Direct Reclaim 和内存 PSI 同时升高。

## 5. 脏页如何阻碍回收

文件页已修改但未回写时不能简单丢弃。回写带宽跟不上写入速度会积累脏页，最终写进程可能被节流或等待回写。此时“内存问题”和“存储问题”会互相放大。

```bash
grep -E 'Dirty|Writeback' /proc/meminfo
sysctl vm.dirty_background_ratio vm.dirty_ratio 2>/dev/null
```

生产参数还可能使用字节值而非 ratio，容器和高速大内存机器也不能照搬固定比例。调整前要理解实际写入模型和内核版本。

## 6. swappiness 不是开关

`vm.swappiness` 影响匿名页与文件页回收之间的相对倾向，不是“设置为 0 就绝不使用 Swap”的通用保证，具体语义随内核演化。数据库、JVM、推理服务应基于工作集、延迟目标和故障策略测试，而不是复制一个万能值。

## 7. Thrashing 的证据链

```text
业务延迟升高
＋ memory PSI some/full 升高
＋ pgscan/pgsteal/allocstall 快速增长
＋ major fault 或 si/so 增长
＋ CPU 花在回收，真正业务吞吐下降
= 高可信的内存抖动证据
```

单独看到 Page Cache 下降或 Swap Used 增长不足以得出结论。

## 8. 练习与答案

**问题：Swap 已使用 20GiB，但 `si/so` 长期为 0，是否必须立即处理？**

答案：不一定。可能只是历史冷页留在 Swap，当前没有换页活动。应继续看可用内存、回收、major fault、PSI 和延迟。

**问题：关闭 Swap 后 OOM 是否更不容易发生？**

答案：通常不是。关闭 Swap 减少匿名页后备空间，内存峰值下可能更早进入回收和 OOM；是否适合取决于延迟目标与容量设计。

下一篇：[HugePage、THP、碎片与 Compaction](./06-HugePage-THP碎片与Compaction.md)
