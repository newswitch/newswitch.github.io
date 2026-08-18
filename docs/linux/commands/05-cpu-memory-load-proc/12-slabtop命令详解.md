---
title: "slabtop 命令详解：内核对象缓存、可回收与不可回收内存"
sidebar_label: "12. slabtop 命令详解：内核对象缓存、可回收与不可回收内存"
sidebar_position: 12
description: "完整讲解 procps-ng slabtop 的全部参数、排序键、字段、SLUB 调试差异、SReclaimable/SUnreclaim 和内核内存增长排障。"
tags: [Linux, slabtop, slab, SLUB, 内核内存, procps-ng]
---

# slabtop 命令详解：内核对象缓存、可回收与不可回收内存

Linux slab allocator 缓存 inode、dentry、socket、文件、进程等内核对象。`slabtop` 实时解析 `/proc/slabinfo`，用于解释“内存不在普通进程 RSS 中，却被内核对象大量占用”。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | procps-ng 4.0.6 |
| 数据源 | `/proc/slabinfo` |
| 安全级别 | `[R]` |

```text
slabtop [option ...]
```

读取 slabinfo 常仅允许 root/特权主体，容器中通常不可见或是宿主机范围。

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-d, --delay=N` | 每 N 秒刷新，默认 3；不能与 `-o` 联用 |
| `-s, --sort=S` | 按一个排序字符排序 |
| `-o, --once` | 只输出一次后退出 |
| 无，`--human` | slab size 自动使用 B/Ki/Mi/Gi/Ti/Pi |
| `-V, --version` | 版本 |
| `-h, --help` | 帮助 |

## 3. 排序键全集与交互键

| 键 | 排序依据 | 主要列 |
|---|---|---|
| `a` | active object 数 | ACTIVE |
| `b` | 每 slab 对象数 | OBJ/SLAB |
| `c` | cache size | CACHE SIZE |
| `l` | slab 数 | SLABS |
| `v` | active slab 数 | 无固定列 |
| `n` | cache name | NAME |
| `o` | object 总数，默认 | OBJS |
| `p` | 每 slab 页数 | 无固定列 |
| `s` | object size | OBJ SIZE |
| `u` | cache utilization | USE |

运行中上述大小写字母都可切换排序；Space 强制刷新，`q/Q` 退出。

## 4. 字段如何读

```bash
sudo slabtop --human -s c
sudo slabtop -o -s c
```

| 字段 | 含义 |
|---|---|
| `OBJS` | cache 中分配的总 object slots |
| `ACTIVE` | 当前 active objects |
| `USE` | active/total 的利用比例，不是系统内存利用率 |
| `OBJ SIZE` | 每 object 大小 |
| `SLABS` | slab 数 |
| `OBJ/SLAB` | 每 slab 的 object 数 |
| `CACHE SIZE` | 该 cache 的 slab 占用估算 |
| `NAME` | cache 名称 |

cache header 的 bytes 统计与 `/proc/meminfo` 的物理 `Slab` 口径不完全相同；官方特别提醒 header 不是物理内存度量。系统容量判断优先交叉验证 `Slab/SReclaimable/SUnreclaim`。

## 5. 可回收与不可回收

```bash
grep -E '^(Slab|SReclaimable|SUnreclaim):' /proc/meminfo
sudo slabtop -o -s c
```

- `SReclaimable`：在内存压力下可能通过 shrinker 回收的 slab，但并非立即/全部可回收。
- `SUnreclaim`：不能通过普通 slab reclaim 回收的部分。
- dentry/inode cache 大常由海量文件遍历、容器层、删除 churn 或文件系统 workload 引起，并非看到大就一定是泄漏。

必须看绝对值、增长速率、业务对象数量、回收后趋势与 kernel 版本/已知问题。

## 6. 典型排障路径

```text
free: available 下降
  → /proc/meminfo: Slab/SUnreclaim 上升？
     → slabtop: 哪个 cache 增长？
        → 对应内核子系统、workload 与对象生命周期
           → tracepoint/kmem、bpf/perf、kernel changelog
```

| cache 示例 | 可能关联 |
|---|---|
| `dentry`、inode 系列 | 文件树扫描、容器镜像层、文件系统 cache |
| `kmalloc-*` | 通用内核分配，只能作为入口，需进一步 tracing |
| `skbuff_*` | 网络包 buffer 与 backlog |
| `task_struct` | 进程/线程数量或退出回收问题 |
| `nf_conntrack*` | conntrack 表与网络连接 |

cache 名与 allocator/kernel 配置相关，不能用固定名称写死告警。

## 7. SLAB/SLUB 与调试边界

现代发行版常用 SLUB，`slabtop` 为兼容接口展示 slab cache。debug、redzone、poison、KASAN 等会显著增加 object/slab 开销；比较机器前先确认 kernel config 与启动参数。

开启 slab debug、trace 或执行 cache drop 都可能造成明显性能影响，不属于只读 `slabtop` 操作。生产变更需测试、回滚与维护窗口。

## 8. 自动化与容器

`slabtop -o` 是终端表格，不是稳定机器格式；字段可能随版本/内核变化。监控使用 `/proc/meminfo` 总量，细项采集可解析 `/proc/slabinfo` 的版本头或使用成熟 exporter。

容器通常共享宿主内核 slab；cgroup kernel memory accounting 也不会自然等于某个 slabtop cache 行。不要把宿主 slab 全量归责于当前 Pod。

## 9. 常见误判、退出状态与实验

| 误判 | 修正 |
|---|---|
| USE 100% 表示内存满 | 它只是该 cache active slots 比例 |
| CACHE SIZE 就是物理 Slab | 与 meminfo 口径交叉验证 |
| dentry 大就是泄漏 | 看 workload、回收、增长与对象生命周期 |
| SReclaimable 都能立即释放 | shrinker/活跃对象/压力决定实际回收 |

成功为 `0`，权限/procfs/参数失败为非 `0`。实验：创建/删除大量测试文件，观察 dentry/inode 与 reclaim；比较 `-s o/c/u`；核对 header 与 meminfo；只在实验机研究 debug 开销。

掌握标准：能列出全部参数、排序与交互键，解释字段和 SReclaimable/SUnreclaim，能从系统内存缩小到内核子系统且不草率归因。

## 10. 官方参考 {/* #官方参考 */}

- [procps-ng slabtop(1)](https://man7.org/linux/man-pages/man1/slabtop.1.html)
- [Linux slabinfo(5)](https://man7.org/linux/man-pages/man5/slabinfo.5.html)
- [Linux SLUB users guide](https://docs.kernel.org/admin-guide/mm/slab.html)

上一篇：[`pmap` 命令详解](./11-pmap命令详解.md)

下一篇：[`prlimit` 命令详解](./13-prlimit命令详解.md)
