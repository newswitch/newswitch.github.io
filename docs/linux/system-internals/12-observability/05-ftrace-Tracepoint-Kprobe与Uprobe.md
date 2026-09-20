---
title: "ftrace、Tracepoint、Kprobe 与 Uprobe：选择稳定事件还是动态探针"
sidebar_label: "05. ftrace、Tracepoint 与 Kprobe"
sidebar_position: 5
description: "理解 function tracer、tracepoint、dynamic probe、ring buffer、filter 和生产采集边界。"
tags: [Linux, ftrace, Tracepoint, Kprobe, Uprobe]
---

# ftrace、Tracepoint、Kprobe 与 Uprobe：选择稳定事件还是动态探针

内核跟踪可以记录函数调用、静态事件或动态地址。优先选择语义稳定的 tracepoint；只有现有事件无法回答问题时，再使用依赖版本和符号的 kprobe。

## 1. 工具边界

| 机制 | 探测位置 | 稳定性与用途 |
|---|---|---|
| function/function_graph | 可跟踪内核函数 | 广泛但数据量大，受编译/过滤影响 |
| tracepoint | 内核预定义静态点 | 字段相对稳定、语义明确 |
| kprobe/kretprobe | 动态内核指令/函数入口返回 | 灵活但依赖版本、原型和可探测性 |
| uprobe/uretprobe | 用户 ELF/库偏移 | 适合用户函数，需正确 binary/build-id/ASLR 映射 |

## 2. tracefs 基础

```bash
cd /sys/kernel/tracing
cat available_tracers
find events/sched -maxdepth 2 -name enable
cat trace_pipe
```

应使用独立 instance、设置 PID/cgroup/event filter、清空 buffer、限制持续时间并在退出时关闭。直接启用 `function` 全系统跟踪可能产生巨大开销。

## 3. Ring Buffer 与丢事件

ftrace 使用 per-CPU ring buffer。buffer 满时 overwrite 或丢弃取决于模式；读取和写入也消耗 CPU。分析必须记录 buffer size、overrun/entries 和 clock。

## 4. Function Graph

function graph 能显示函数嵌套和持续时间，但 IRQ 抢占、调度和 tracing 本身会影响解读。函数总时长可能包含子调用与被打断时间，不能直接等价为独占 CPU 时间。

## 5. 动态探针风险

优化、内联、尾调用、不同原型、BTF/DWARF 缺失和 kretprobe 并发都会影响参数解释。错误读取内核内存不仅数据错误，还可能增加风险；先在同版本测试环境验证。

## 6. 练习与答案

**问题：为什么相同函数名在升级内核后 kprobe 脚本失效？**

答案：函数可能改名、内联、静态化、参数变化或不再可探测。tracepoint 若覆盖需求，通常更稳定。

**问题：trace 中没有事件，是否证明路径没执行？**

答案：不证明。可能 filter/PID/instance/CPU 不匹配、事件未启用、buffer 丢失或代码走另一实现。

下一篇：[eBPF 执行模型、Verifier 与观测边界](./06-eBPF执行模型-Verifier与观测边界.md)
