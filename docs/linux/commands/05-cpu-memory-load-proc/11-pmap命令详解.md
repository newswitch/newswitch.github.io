---
title: "pmap 命令详解：进程地址空间、RSS、PSS、匿名页与映射归因"
sidebar_label: "11. pmap 命令详解：进程地址空间、RSS、PSS、匿名页与映射归因"
sidebar_position: 11
description: "完整讲解 procps-ng pmap 的全部参数、maps/smaps、虚拟地址、RSS/PSS/private/shared/dirty/swap、权限与内存泄漏排障边界。"
tags: [Linux, pmap, 虚拟内存, RSS, PSS, smaps]
---

# pmap 命令详解：进程地址空间、RSS、PSS、匿名页与映射归因

`pmap` 报告一个或多个进程的虚拟内存映射。它能回答“地址空间由哪些匿名区、heap、stack、共享库和 mmap 文件组成”，但一次快照不能单独证明泄漏。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | procps-ng 4.0.6 |
| 数据源 | `/proc/PID/maps`、`smaps`、`smaps_rollup` 等 |
| 安全级别 | 读取 `[R]`；创建 pmap rc 配置 `[W]` |

```text
pmap [option ...] pid ...
```

```bash
pmap -V
pmap --help
```

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-x, --extended` | 扩展格式 |
| `-d, --device` | 显示 device/offset 等格式 |
| `-q, --quiet` | 隐藏部分 header/footer |
| `-A, --range=LOW[,HIGH]` | 只显示地址范围；LOW/HIGH 必须用一个逗号参数 |
| `-X` | 比 `-x` 更详细；格式随 `/proc/PID/smaps` 改变 |
| `-XX` | 显示内核提供的全部 smaps 字段 |
| `-p, --show-path` | 映射列显示完整路径 |
| `-k, --use-kernel-name` | 可用时用内核映射名替代 `[ anon ]` |
| `-c, --read-rc` | 读取默认配置 |
| `-C, --read-rc-from=FILE` | 从 FILE 读取配置 |
| `-n, --create-rc` | 创建默认配置 |
| `-N, --create-rc-to=FILE` | 将配置写到 FILE |
| `-h, --help` | 帮助 |
| `-V, --version` | 版本 |

`-X/-XX` 的列不是稳定 API；自动化应直接按 `/proc/PID/smaps_rollup` 字段名解析，并容忍内核新增项。

## 3. 映射是什么

每行表示一段连续虚拟地址区间，拥有权限、文件 offset、device/inode 和可选 pathname。常见类型：

```text
可执行文件 text/data
共享库
[heap]
[stack] / [stack:TID]
[vdso] [vvar] [vsyscall]
匿名 mmap
文件 mmap
共享内存/memfd
```

VIRT/size 是地址范围，不代表已分配同等 RAM；文件或匿名映射可能尚未 fault-in，多个进程也可共享同一物理页。

## 4. `-x/-X/-XX` 关键字段

```bash
pmap -x 1234
pmap -X -p 1234
pmap -XX 1234
```

| 字段 | 含义 |
|---|---|
| `Size` | 虚拟映射大小 |
| `Rss` | 当前驻留物理页，shared 页会在多个进程重复出现 |
| `Pss` | 共享页按共享者数量分摊，更适合跨进程归因 |
| `Private_Clean/Dirty` | 仅此进程归属的 clean/dirty 页 |
| `Shared_Clean/Dirty` | 可共享页 |
| `Anonymous` | 不由普通文件内容后备的页 |
| `Swap` | 当前映射已换出的页 |
| `SwapPss` | Swap 页的比例分摊口径（内核支持时） |
| `AnonHugePages/ShmemPmdMapped/FilePmdMapped` | THP/huge mapping 相关 |
| `VmFlags` | 映射内核标志，语义随内核演进 |

PSS 仍是观测时刻估算；扫描 smaps 本身可能昂贵。精确 heap 对象归因必须使用语言 runtime/allocator profiler。

## 5. 推荐排障方法

先确认进程身份，再保存两次快照：

```bash
pid=1234
ps -o pid,lstart,etime,comm,args -p "$pid"
pmap -X -p "$pid"
sleep 60
pmap -X -p "$pid"
```

重点比较匿名 private dirty、heap、某文件 mmap、shared memory、thread stack 数量和 Swap，而非只比较总 VIRT。持续增长还要与业务吞吐、GC cycle、cache 配置和 cgroup working set 对齐。

## 6. 地址范围与 crash/perf 联动

```bash
pmap -A 0x7f0000000000,0x7fffffffffff -X 1234
```

地址必须按本机支持的格式提供。它可将 crash address、perf sample 或 `/proc/PID/maps` 中地址落到某个 mapping，但 ASLR 使每次启动地址可能变化；符号级定位仍需 binary/debug symbols。

## 7. 权限、竞态与容器

ptrace access mode、Yama、hidepid、LSM、UID 和 container PID namespace 会限制 maps/smaps。读取期间进程可退出或改变映射，单次输出不是事务快照；PID 可复用，至少核对启动时间。

路径可能暴露租户目录、模型名、删除但仍映射的文件；故障材料需脱敏。`-XX` 对超大地址空间/数十万映射可产生明显 CPU 和输出，先限定 PID/范围。

## 8. 常见误判

| 误判 | 修正 |
|---|---|
| VIRT 很大就是占满 RAM | VIRT 是地址空间，优先 RSS/PSS/private |
| 各进程 RSS 相加等于物理内存 | shared 页被重复计数 |
| heap 行就是语言 heap 全部对象 | allocator 可用 mmap、多 arena；需 runtime profiler |
| 一次 RSS 高就是泄漏 | 观察同负载下长期趋势和对象生命周期 |
| RSS 下降才表示 free 成功 | allocator 可能保留 arena 不归还 OS |

## 9. 退出状态、实验与掌握标准

`0` 成功，`1` 一般失败，`42` 表示请求的 PID 未全部找到。实验：创建 heap、file mmap、shared mmap、线程 stack；比较 maps/-x/-X/-XX；删除仍被 mmap 的文件；比较 RSS 与 PSS；验证进程退出竞态。

掌握标准：能列出全部参数，解释映射和关键内存字段，从增长趋势缩小到 mapping 类别，并说明 pmap、cgroup 与语言 heap profiler 的分工。

## 10. 官方参考 {/* #官方参考 */}

- [procps-ng pmap(1)](https://man7.org/linux/man-pages/man1/pmap.1.html)
- [Linux proc_pid_smaps(5)](https://man7.org/linux/man-pages/man5/proc_pid_smaps.5.html)
- [Linux proc_pid_maps(5)](https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html)

上一篇：[`time` 命令详解](./10-time命令详解.md)

下一篇：[`slabtop` 命令详解](./12-slabtop命令详解.md)
