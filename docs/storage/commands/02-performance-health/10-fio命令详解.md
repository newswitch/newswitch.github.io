---
title: "fio 命令详解：可复现 I/O 压测、延迟分位数与数据安全"
sidebar_label: "10. fio 命令详解：可复现 I/O 压测、延迟分位数与数据安全"
sidebar_position: 10
description: "以 fio 3.42 文档为基线，讲解 job 生命周期、核心命令行与 job 参数族、ioengine、iodepth、numjobs、direct、fsync、验证、JSON 输出和生产压测边界。"
tags: [Linux, fio, 存储性能, IOPS, 延迟, 压测]
---

# fio 命令详解：可复现 I/O 压测、延迟分位数与数据安全

`fio`（Flexible I/O Tester）生成可配置 I/O 工作负载。它不是“跑一个数字”的工具：目标、读写模式、块大小、并发、队列深度、缓存、数据集大小、运行时间和持久性语义任何一项不同，结果都不可直接比较。

> 对裸设备执行 write/randwrite 会覆盖数据。生产必须优先使用专用测试文件和独立容量配额。

## 1. 版本与执行模型

```bash
fio --version
fio --enghelp
fio --cmdhelp=all
```

本文按 fio 3.42 稳定对象模型编写。fio 参数非常多，并随 ioengine/平台扩展；文章完整覆盖性能实验的必需参数族，具体 engine 参数以 `--cmdhelp` 为最终准据。

```text
global options
  └─ job（线程/进程）× numjobs
       └─ file/device × nrfiles
            └─ ioengine submission/completion
```

## 2. 顶层 CLI 参数

| 参数 | 作用 |
|---|---|
| `--name=JOB` | 开始一个 job；命令行 job 必需 |
| `--section=NAME` | 只运行 job file 的指定 section |
| `--output=FILE` | 输出文件 |
| `--output-format=normal,json,json+,...` | 输出格式，可组合 |
| `--minimal` / `--terse-version=N` | 稳定性有限的简洁格式/版本 |
| `--runtime=SEC` | 顶层覆盖运行时间 |
| `--time-based` | 按时间循环，而非做完 size 就结束 |
| `--eta=WHEN` / `--eta-interval=N` | ETA 行为 |
| `--status-interval=N` | 周期输出完整状态 |
| `--readonly` | 禁止任何 write workload，重要保护 |
| `--max-jobs=N` | 最大 job 数 |
| `--server[=args]` / `--client=host` | fio client/server；并非存储服务压测协议 |
| `--parse-only` | 只解析 job file |
| `--showcmd=FILE` | 把 job file 展开为命令行 |
| `--cmdhelp=OPT` | 参数帮助 |
| `--enghelp[=ENGINE]` | ioengine 帮助 |
| `--debug=TYPE` | 调试，可能产生大量输出 |

## 3. 目标与数据集参数

| 参数 | 含义 |
|---|---|
| `filename` / `directory` | 精确文件/设备或生成文件所在目录 |
| `size` | 每个 job/file 的工作集范围；不是总写入量的简单保证 |
| `filesize`、`nrfiles` | 多文件大小和数量 |
| `offset`、`offset_increment` | 每个 job 的起点与隔离区间 |
| `file_service_type` | 多文件选择方式 |
| `create_on_open`、`fallocate` | 文件创建/预分配策略 |
| `unlink` | job 结束删除测试文件 |

多个 `numjobs` 指向同一个 filename 且没有 offset 分区，会竞争同一数据范围；这是有意并发还是配置错误必须写进实验说明。

## 4. 负载模型

| 参数 | 典型值 |
|---|---|
| `rw` | `read/write/randread/randwrite/rw/randrw/trim/...` |
| `rwmixread` / `rwmixwrite` | 混合读写比例 |
| `bs` | `4k`、`128k`、`1m`；可用 `bsread/bswrite` |
| `bssplit` | 按比例混合 block size |
| `random_distribution` | uniform/zipf/pareto/normal 等 |
| `norandommap` | 不维护随机 block map，可能重复命中 |
| `randrepeat` / `randseed` | 控制随机序列可复现性 |
| `rate` / `rate_iops` | 限制吞吐/IOPS |
| `thinktime` | 模拟请求间停顿 |

`randread` 不是自动代表数据库/模型加载；真实 trace、冷热比例、read amplification 和 fsync 行为仍需单独建模。

## 5. 并发、队列与 engine

```text
总潜在并发 ≈ numjobs × iodepth
```

但只有异步 engine 且后端接受异步请求时，`iodepth` 才可能达到期望。关键参数：

| 参数 | 作用 |
|---|---|
| `ioengine` | `psync`、`libaio`、`io_uring`、`mmap`、`sync` 等 |
| `iodepth` | 每 job 在途深度 |
| `iodepth_batch_submit/complete` | 提交和回收批量 |
| `numjobs` | 克隆 job 数 |
| `thread` | 使用线程而非进程 |
| `cpus_allowed` / `numa_cpu_nodes` | CPU/NUMA 绑定 |
| `hipri`、`fixedbufs`、`registerfiles` | io_uring 等 engine 专属优化 |

结果中 `IO depths` 分布若始终在 1，说明配置没有真正形成深队列。

## 6. Cache 与持久性

| 参数 | 语义 |
|---|---|
| `direct=1` | 请求绕过 page cache；仍受设备/控制器 cache 影响 |
| `buffered=1` | buffered I/O |
| `fsync=N` / `fdatasync=N` | 每 N 次 write 同步 |
| `sync_file_range` | Linux writeback 控制 |
| `end_fsync=1` | job 末尾 fsync |
| `invalidate=1` | 开始前尝试失效 cache |
| `refill_buffers` / `scramble_buffers` | 避免压缩/重复 buffer 造成虚高 |

`direct=1` 不等于数据已持久化；设备 volatile write cache、FUA/flush 支持和远端存储确认语义必须一起验证。

## 7. 时间、预热和稳态

```ini
time_based=1
runtime=60s
ramp_time=15s
```

`ramp_time` 让 job 先预热但仍会产生 I/O。SSD 需要考虑预处理、SLC cache、GC 和 steady state；云盘需要考虑 burst credit。单次短测试不能代表持续能力。

## 8. 结果判读

```text
IOPS / BW          完成速率
slat               fio 提交到内核的时间
clat               提交后到完成的时间
lat                slat + clat
percentile         p50/p95/p99/p99.9 等分布
Disk stats         内核块设备统计
```

延迟单位可能是 nsec/usec/msec，必须读标题。平均值不能替代高分位；客户端 fio 延迟也不能独自定位网络、服务端还是介质。

## 9. 安全 job file 示例

```ini
[global]
ioengine=io_uring
direct=1
time_based=1
runtime=60s
ramp_time=10s
group_reporting=1
directory=/srv/fio-lab
size=4G
filename=fio-test.bin

[randread-4k]
rw=randread
bs=4k
iodepth=32
numjobs=4
```

```bash
mkdir -p /srv/fio-lab
fio --parse-only test.fio
fio --output-format=json --output=result.json test.fio
jq '.jobs[] | {jobname, read}' result.json
```

先用 `--readonly` 检查任何声称只读的 job：

```bash
fio --readonly test.fio
```

## 10. 数据校验与故障注入

`verify`、`verify_pattern`、`do_verify`、`verify_fatal`、`verify_backlog` 可验证写后读的数据完整性。但验证会改变负载和运行阶段；必须和纯性能测试分开报告。`stonewall/new_group` 用于串行阶段与分组。

## 11. 常见错误

- 在 mounted 生产裸设备上 randwrite；这是数据破坏。
- 测试文件小于内存却声称测盘；检查 cache/direct 和工作集。
- `iodepth=128` 配 `psync` 后认为深度已生效。
- 只报最大 IOPS，不报 latency percentile、error、CPU、设备状态和持续时间。
- 多 client 时钟、开始时间、数据范围和服务端瓶颈未统一。
- 用 fio 客户端/server 模式误以为在测远端文件系统协议。

## 12. 完成标准

能写出含目标、读写比例、bs、engine、depth、jobs、cache、size、runtime、预热、验证和安全边界的 job file，并能解释 clat 分位数与块设备 iostat 的关系。

参考：[fio 3.42 官方文档](https://fio.readthedocs.io/en/latest/fio_doc.html)。
