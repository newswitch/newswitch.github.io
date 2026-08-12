---
title: nproc 命令详解：可用 CPU、affinity、cgroup 配额与并行度
sidebar_position: 2
description: 完整讲解 GNU nproc 的全部参数、available 与 installed CPU、OpenMP 环境变量、affinity、cpuset 和 cgroup v2 quota。
tags: [Linux, nproc, CPU, cgroup, affinity, coreutils]
---

# `nproc` 命令详解：可用 CPU、affinity、cgroup 配额与并行度

`nproc` 输出当前进程可用的处理单元数量。它不是简单统计 `/proc/cpuinfo`，在容器和批处理系统中通常比“宿主机有几个 CPU”更接近安全并行度。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils 9.11 |
| 输出 | 保证为大于 0 的整数 |
| 安全级别 | `[R]` |

```text
nproc [OPTION]
```

```bash
nproc --version
nproc --help
```

## 2. 全部参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| 无 | `--all` | 输出系统 installed CPU 数；忽略 OpenMP 变量与 cgroup quota |
| 无 | `--ignore=N` | 若可能，在结果中减去 N，但最终仍至少为 1 |
| 无 | `--help` | 帮助 |
| 无 | `--version` | 版本 |

该命令故意很小，没有 `-a`、`-i` 等短参数。

## 3. installed、online、allowed、quota

```text
installed CPU
  └─ online CPU
       └─ affinity/cpuset 允许集合
            └─ cgroup CPU quota 折算上限
                 └─ OpenMP 环境约束
                      = nproc 默认结果
```

具体实现和内核能力会影响计算。`--all` 更接近 installed 数量，不等于当前可运行数；`lscpu -e` 能看 online/offline，`taskset`/cpuset 决定允许在哪些 CPU 上运行，cgroup `cpu.max` 决定一段周期内最多使用多少 CPU 时间。

## 4. OpenMP 环境变量

`OMP_NUM_THREADS` 与 `OMP_THREAD_LIMIT` 会影响默认结果：前者提供线程数量约束，后者提供上限。它们是环境，不是内核 CPU 容量。

```bash
nproc
OMP_NUM_THREADS=2 nproc
OMP_NUM_THREADS=8 OMP_THREAD_LIMIT=4 nproc
nproc --all
```

不要因为某应用碰巧设置了 OpenMP 变量，就把 `nproc` 结果写入全局容量数据库。

## 5. 容器与 cgroup v2

```bash
nproc
nproc --all
cat /sys/fs/cgroup/cpu.max 2>/dev/null
cat /sys/fs/cgroup/cpuset.cpus.effective 2>/dev/null
cat /sys/fs/cgroup/cpu.stat 2>/dev/null
```

`cpu.max` 的 `max 100000` 表示没有 quota 上限；`200000 100000` 表示每周期可获得约 2 个 CPU 的时间。配额允许任务在多个 CPU 上突发运行，但长期 CPU 时间仍受限；它不等同固定 CPU 绑定。

## 6. 选择并行度

```bash
workers=$(nproc --ignore=1) || exit 1
make -j"$workers"
```

保留一个 CPU 不是普适优化。编译、压缩、IO、内存带宽、NUMA、许可证、限流与同机租户都会影响最佳并行度。`nproc` 是起点，需通过基准与 SLO 验证。

脚本应校验用户给定上限：

```bash
available=$(nproc) || exit 1
requested=${WORKERS:-$available}
case $requested in (*[!0-9]*|'') exit 2;; esac
(( requested >= 1 && requested <= available )) || exit 2
```

## 7. 常见误判

| 误判 | 原因 |
|---|---|
| `nproc --all` 适合容器线程池 | 它忽略 cgroup quota/OpenMP，可能严重超配 |
| `nproc` 等于物理核数 | 返回处理单元，可能包含 SMT 线程 |
| quota=2 就只能在两个固定 CPU 上跑 | quota 是时间预算，cpuset 才是允许集合 |
| 多开到 nproc 一定最快 | 还受内存、IO、锁和同机争用影响 |

## 8. 退出状态、实验与掌握标准

成功为 `0`，探测/参数失败为非 `0`。实验：记录 `nproc`、`--all`、`lscpu -e`、当前 affinity、cpuset 与 quota；在受限容器中比较结果；验证 OpenMP 变量和 `--ignore`。

掌握标准：能解释四种 CPU 数量的区别，能安全设置并行度上限，并知道何时必须看 cgroup throttling 和实际基准。

## 官方参考

- [GNU coreutils 9.11：nproc](https://www.gnu.org/software/coreutils/manual/html_node/nproc-invocation.html)
- [Linux cgroup v2 CPU controller](https://docs.kernel.org/admin-guide/cgroup-v2.html#cpu)
- [Linux sched_getaffinity(2)](https://man7.org/linux/man-pages/man2/sched_getaffinity.2.html)

上一篇：[`uptime` 命令详解](./01-uptime命令详解.md)

下一篇：[`lscpu` 命令详解](./03-lscpu命令详解.md)
