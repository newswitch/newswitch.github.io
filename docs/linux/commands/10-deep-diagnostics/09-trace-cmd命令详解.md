---
title: trace-cmd 命令详解：ftrace 事件录制、过滤、回放与远程代理
sidebar_position: 9
description: 讲清 trace-cmd list/start/record/stop/extract/report/reset、event/filter/trigger、buffer、PID/CPU、function graph 和生产清理。
tags: [Linux, trace-cmd, ftrace, tracepoint, 内核]
---

# `trace-cmd` 命令详解：把 ftrace 变成可回放证据

`trace-cmd` 管理 tracefs/ftrace，能列出事件、配置过滤器、录制每 CPU ring buffer 到 `trace.dat` 并离线 report。与直接读 `trace_pipe` 相比，它更适合保存和复盘；配置全局 tracefs 仍会影响其他 tracer。

## 1. 子命令地图

| 子命令 | 用途 |
|---|---|
| `list` | 列 tracer、events、functions、options |
| `record [CMD]` | 配置、运行并保存 `trace.dat` |
| `start` | 配置并启动，不立即提取 |
| `stop`、`restart` | 停止/恢复 ring buffer 记录 |
| `extract` | 把当前 buffer 导出为数据文件 |
| `report` | 离线解析 `trace.dat` |
| `stream` | 实时输出，不生成数据文件 |
| `snapshot` | 操作 ftrace snapshot buffer |
| `reset` | 重置 tracing 配置和 buffer |
| `stat` | 查看当前配置 |
| `agent`、`listen` | VM/远程录制协作 |

## 2. record 关键参数

```bash
trace-cmd list -e 'sched:*'
sudo trace-cmd record -e sched:sched_switch -e sched:sched_wakeup \
  -P 1234 -C 0-7 -b 4096 -o sched.dat -- sleep 10
trace-cmd report -i sched.dat
```

| 参数族 | 代表参数 | 含义 |
|---|---|---|
| tracer | `-p TRACER`、`-O OPTION` | function/function_graph 等 tracer 与选项 |
| event | `-e EVENT`、`-f FILTER`、`-R TRIGGER`、`-v` | 事件、过滤、trigger、排除 |
| function | `-l FUNC`、`-n FUNC`、`-g FUNC` | function filter/notrace/graph function |
| target | `-P PID`、`-F`、`-c`、`-C CPU-LIST` | PID、跟随 fork、指定 command/CPU |
| buffer | `-b KB`、`-B NAME`、`--subbuf-size KB` | 主/实例 buffer 大小 |
| time/output | `-s INTERVAL`、`--date`、`-o FILE`、`--compression` | 刷新、时钟关联、文件与压缩 |
| stack | `-T`、`--func-stack` | kernel stack / function stack |

精确短参数会随 trace-cmd 大版本变化，保存命令时记录 `trace-cmd --version`。

## 3. 事件过滤而非事后淹没

```bash
sudo trace-cmd record -e block:block_rq_issue \
  -f 'dev == 259,0' -e block:block_rq_complete \
  -f 'dev == 259,0' -- sleep 10
```

先读 `/sys/kernel/tracing/events/SYSTEM/EVENT/format` 确认字段和类型。过滤在内核侧减少写入；仅在 report 阶段过滤不能挽回 ring buffer 覆盖和采集开销。

## 4. 风险、冲突与清理

- function_graph 通配内核函数开销可能极高；优先静态 tracepoint。
- ring buffer 太小会覆盖，太大占用每 CPU 内存；报告 lost events。
- perf、bpftrace、其他 trace-cmd 可能共享/竞争 tracefs 配置；优先 named instance。
- 无论正常或异常结束都执行 `trace-cmd stop`/`reset` 并用 `trace-cmd stat` 验证。
- 数据含进程名、路径和内核行为，按敏感证据保存。

## 5. 验收与参考

能从 event format 写精确过滤，估算 buffer 和时长，离线 report，并证明 tracer/trigger/filter/buffer 已恢复。

- [trace-cmd documentation](https://trace-cmd.org/Documentation/)
- [Linux ftrace documentation](https://docs.kernel.org/trace/ftrace.html)

下一篇：[bpftrace 命令详解](./10-bpftrace命令详解.md)。
