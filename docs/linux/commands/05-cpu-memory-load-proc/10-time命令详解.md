---
title: time 命令详解：墙钟、CPU、峰值 RSS、缺页与退出状态
sidebar_position: 10
description: 完整讲解 GNU Time 1.10 与 Bash time 的区别、全部参数、format specifier、stderr、pipeline、峰值 RSS、上下文切换和基准边界。
tags: [Linux, time, Benchmark, CPU, 内存, GNU Time]
---

# `time` 命令详解：墙钟、CPU、峰值 RSS、缺页与退出状态

`time` 运行一个命令并在结束后报告 `getrusage/wait` 可见的时间与资源。它适合比较一次任务的墙钟、CPU、峰值 RSS、缺页和上下文切换，但不是微基准框架或持续 profiler。

## 1. 必须先识别实现

```bash
type -a time
type -P time
env time --version
/usr/bin/time --version
help time
```

Bash 的 `time` 是 reserved word，可计量 pipeline；`/usr/bin/time` 常为 GNU Time 1.10，参数更丰富。直接执行 `time --version` 可能把 `--version` 当成待计量命令；本文主体是 GNU 外部程序。

## 2. GNU Time 语法与全部参数

```text
time [options] command [arguments ...]
```

所有 time 选项必须出现在 command 之前，command 之后都传给目标。

| 参数 | 含义 |
|---|---|
| `-f FORMAT, --format=FORMAT` | 自定义资源格式 |
| `-p, --portability` | POSIX `real/user/sys` 格式 |
| `-v, --verbose` | 每项一行的完整英文资源报告 |
| `-o FILE, --output=FILE` | 资源报告写 FILE，默认覆盖 |
| `-a, --append` | 配合 `-o` 追加 |
| `-q, --quiet` | 不报告目标的非零退出或信号终止警告；不改变退出状态 |
| `--help` | 帮助 |
| `-V, --version` | 版本 |
| `--` | 终止 time 自身选项，之后第一个参数是 command |

默认资源报告写 stderr，不是 stdout。因此 `time cmd >out` 仍会在终端显示 time；要分离用 `-o`，不要混淆目标自身 stderr。

## 3. format specifier 全集

| 类别 | specifier |
|---|---|
| 时间 | `%E` `[h:]m:s` 墙钟、`%e` 秒、`%U` user CPU 秒、`%S` system CPU 秒、`%P` CPU 百分比 |
| 内存 | `%M` peak RSS KiB、`%t` average RSS、`%K` average total、`%D` unshared data、`%p` stack、`%X` shared text、`%Z` page size |
| IO/调度 | `%F` major fault、`%R` minor fault、`%W` swaps、`%c` involuntary switch、`%w` voluntary switch、`%I/%O` filesystem input/output、`%r/%s` socket messages、`%k` signals |
| 命令/退出 | `%C` 命令行、`%x` exit status、`%Tt` exit type、`%Tx` normal exit code、`%Tn` signal number、`%Ts` signal name、`%To` 成功时 `ok` |
| 字面/转义 | `%%` 百分号、`\t` TAB、`\n` newline、`\\` backslash |

部分 Unix 不提供全部 rusage 字段，会显示 0；0 不一定表示资源从未发生。`%M` 是被计量进程及实现可归集范围的峰值口径，不等于 cgroup 峰值、GPU 显存或完整进程树瞬时总和。

## 4. 常用模板

```bash
/usr/bin/time -v -- ./worker --input data.bin

/usr/bin/time -f 'elapsed=%e user=%U sys=%S cpu=%P maxrss_kib=%M major=%F minor=%R vcsw=%w ivcsw=%c exit=%x' \
  -o metrics.txt -- ./worker

/usr/bin/time -a -o history.log -f '%C\t%e\t%M\t%x' -- ./job
```

FORMAT/`%C` 可能记录 token、密码和隐私参数；指标文件要限制权限并脱敏。`TIME` 环境变量在未给 `-f` 时提供默认 format，也可能造成跨环境输出差异。

## 5. real、user、sys 与并行

- real/elapsed 是墙钟，从开始到结束，含等待 CPU、IO、锁和 sleep。
- user 是用户态累计 CPU 时间；sys 是内核代表任务执行的 CPU 时间。
- 多核并行时 `user + sys` 可以大于 real，CPU% 可超过 100%。
- CPU% 低不自动证明 IO 瓶颈，也可能等待锁、网络、限流或外部服务。

```text
近似 CPU 并行度 = (user + sys) / elapsed
```

只有在测量范围、负载阶段和环境稳定时这个近似才有解释力。

## 6. pipeline 与 Shell 边界

```bash
# Bash reserved word：计量整个 pipeline
time producer | consumer

# 外部 time：只计量 producer；consumer 是 Shell pipeline 的另一进程
/usr/bin/time producer | consumer

# 外部 time 计量一个显式 Shell 及其 pipeline
/usr/bin/time bash -c 'producer | consumer'
```

第三种会引入 Shell，退出状态是否代表 pipeline 失败取决于 `pipefail`；可信固定脚本可用 `bash -o pipefail -c ...`，不要把不可信输入拼进 `-c`。

## 7. 基准测试的正确方法

至少做到：固定版本/数据/CPU 与 cgroup；预热 cache/JIT；多次运行；区分冷/热 cache；记录频率、NUMA、同机负载；报告分布而非最好一次。

`time` 本身无法给出函数/Kernel hotspot、尾延迟、GPU 时间或 IO latency。CPU hotspot 转 profiler/perf，系统历史用 sar，GPU 用 Nsight/PyTorch profiler，服务用压测与 tracing。

## 8. 退出状态

GNU Time 自身无法运行命令时常用 `126`（找到但不能执行）或 `127`（未找到）；命令正常执行时传播其退出码，因信号结束按实现/Shell 规则体现。不要只看 time 报告，始终保存 `$?`：

```bash
/usr/bin/time -o metrics.txt -f '%Tt %Tx %Tn %Ts' -- ./job
status=$?
printf 'wrapper_status=%d\n' "$status"
```

## 9. 常见误判、实验与掌握标准

| 误判 | 修正 |
|---|---|
| `time --version` 一定看版本 | Shell reserved word 可能计量名为 `--version` 的命令 |
| real 就是 CPU 时间 | real 含所有等待，CPU 是 user+sys |
| max RSS 是整个容器峰值 | rusage 与 cgroup 口径不同 |
| 一次更快就完成优化 | 需预热、多次、分布、同环境 |
| 外部 time 自动计量整个 pipeline | 默认只包住紧邻 command |

实验：比较 Bash/GNU/POSIX 格式；计量 sleep、单线程、多线程、文件冷/热 cache；验证 stdout/stderr/-o；比较正常退出与信号退出；比较进程 peak RSS 与 cgroup peak。

掌握标准：能识别实现、列出全部参数和格式符，解释时间/内存/缺页/切换口径，正确计量 pipeline，并设计可复现而非单次的基准。

## 官方参考

- [GNU Time 1.10 Manual](https://www.gnu.org/software/time/manual/time.html)
- [GNU Bash Pipelines 与 time](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)
- [Linux getrusage(2)](https://man7.org/linux/man-pages/man2/getrusage.2.html)

上一篇：[`sar` 命令详解](./09-sar命令详解.md)

下一篇：[`pmap` 命令详解](./11-pmap命令详解.md)
