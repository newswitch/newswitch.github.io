---
title: perf record 与 report 命令详解：采样、调用栈、符号与热点归因
sidebar_position: 6
description: 讲清 perf record 的事件/频率/周期、PID/CPU/cgroup、call graph、AUX、输出与 perf report 的排序、children、stdio。
tags: [Linux, perf record, perf report, 火焰图, 性能分析]
---

# `perf record` 与 `perf report`：采集和解释必须成对

`perf record` 把事件样本写入 `perf.data`，`perf report` 解析样本并按 DSO、symbol、thread、CPU 等维度聚合。百分比是“已采到样本的占比”，不是函数精确耗时，也不包含没有采样到或无法展开的栈。

## 1. record 核心参数

```text
perf record [OPTIONS] [COMMAND]
perf record [OPTIONS] -p PID|-t TID|-a
```

| 参数 | 含义 |
|---|---|
| `-e EVENT` | 采样事件，可重复或用 event group |
| `-F HZ`、`-c PERIOD` | 按频率或事件周期采样 |
| `-p PID`、`-t TID`、`-a`、`-C CPUS`、`-G CGROUP` | 目标范围 |
| `-g`、`--call-graph METHOD[,SIZE]` | 采调用栈：fp、dwarf、lbr 等 |
| `--no-inherit`、`--inherit` | 子任务是否继承事件 |
| `-o FILE`、`--append`、`--switch-output[=MODE]` | 输出与轮转 |
| `-m PAGES` | mmap ring buffer 大小 |
| `--aio[=N]`、`--compression-level=N` | 异步写与压缩（依构建） |
| `--timestamp`、`--sample-cpu` | 记录额外样本字段 |
| `--buildid-all`、`--no-buildid` | build ID 处理 |
| `--delay MS`、`--control FD` | 延迟或外部 enable/disable |
| `--snapshot` | AUX trace snapshot 模式 |

```bash
timeout 30s perf record -F 99 -g --call-graph dwarf -p 1234 -o app.data
perf record -e cycles:u -g -- command
```

99 Hz 可避免与常见周期锁步，但只是起点。DWARF 栈数据量和 CPU 开销更大；有可靠 frame pointer 时优先 `fp`，Intel LBR 深度有限且受硬件约束。

## 2. report 核心参数

| 参数 | 含义 |
|---|---|
| `-i FILE` | 输入数据 |
| `--stdio`、`--tui` | 文本或交互界面 |
| `-s KEYS`、`--sort` | comm、dso、symbol、cpu、srcline 等排序键 |
| `--percent-limit=N` | 隐藏低占比项 |
| `--children`、`--no-children` | 是否累计子调用栈开销 |
| `-g MODE,MIN,ORDER` | 调用图显示方式与阈值 |
| `--pid/--tid/--comms/--dsos/--symbols` | 报告时过滤 |
| `--header`、`--header-only` | 查看采集元数据 |
| `--show-nr-samples` | 显示样本数 |

```bash
perf report -i app.data --stdio --sort comm,dso,symbol --percent-limit 0.5
perf report -i app.data --header-only
```

## 3. 符号与百分比陷阱

`[unknown]` 常来自缺少 debuginfo、JIT map、容器 rootfs、权限或栈展开失败。先保存相同二进制及 build ID；不要在另一台版本不同的机器直接解析路径同名文件。`Children` 是包含后代栈的累计成本，`Self` 是样本落在符号本身，两者不能相加。

## 4. 数据质量与生产纪律

- 检查 `perf report --header` 的 lost samples、event、frequency、CPU 与时间。
- 限 PID/cgroup、低频、短时，先估算 `perf.data` 空间。
- 采集文件可能泄露函数名、路径、进程名和业务行为，按敏感数据保存。
- 采样证明相关性，不单独证明因果；与 off-CPU、日志和业务请求时间线交叉验证。

## 5. 验收与参考

能选择采样事件和栈方法，解释 Self/Children，定位 unknown symbol，并使两次采集在同一范围与基线下可比较。

- [perf-record(1)](https://man7.org/linux/man-pages/man1/perf-record.1.html)
- [perf-report(1)](https://man7.org/linux/man-pages/man1/perf-report.1.html)

下一篇：[perf top 命令详解](./07-perf-top命令详解.md)。
