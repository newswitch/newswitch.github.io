---
title: "Linux 可观测性导读"
sidebar_label: "00. Linux 可观测性导读"
sidebar_position: 0
description: "把指标、日志、事件、Trace、Profile 和内核接口组合成可验证的系统证据链。"
tags: [Linux, Observability, perf, ftrace, eBPF]
---

# Linux 可观测性导读

工具输出不是结论。可观测性的目标是把“用户感到慢”逐层转换为可证伪的假设：时间消耗在哪个阶段、哪个资源排队、哪个对象在增长、哪条内核路径被执行。

## 1. 证据类型

| 类型 | 回答的问题 | 局限 |
|---|---|---|
| 指标 | 规模、速率、分位数和趋势怎样 | 聚合后可能丢失个体和调用关系 |
| 日志 | 某个组件主动记录了什么事件 | 未记录不等于没发生，时间和采样可能失真 |
| Trace | 一次事件经过哪些阶段，各阶段多久 | 数据量大，需要稳定关联标识 |
| Profile | 一段时间把 CPU/等待花在哪里 | 统计视角不能天然还原单次请求 |
| Dump | 某一时刻内存与状态是什么 | 是快照，不直接说明演化过程 |

## 2. 本模块文章

1. [指标、日志、Trace 与 Profile 的边界](./01-指标日志Trace与Profile的边界.md)
2. [procfs、sysfs、debugfs 与 tracefs](./02-procfs-sysfs-debugfs与tracefs.md)
3. [strace：从系统调用定位等待点](./03-strace从系统调用定位等待点.md)
4. [perf：PMU、采样与火焰图原理](./04-perf-PMU采样与火焰图原理.md)
5. [ftrace、Tracepoint、Kprobe 与 Uprobe](./05-ftrace-Tracepoint-Kprobe与Uprobe.md)
6. [eBPF 执行模型、Verifier 与观测边界](./06-eBPF执行模型-Verifier与观测边界.md)
7. [Core Dump、SysRq、pstore 与崩溃证据](./07-Core-Dump-SysRq-pstore与崩溃证据.md)
8. [时间同步、关联标识与证据可信度](./08-时间同步关联标识与证据可信度.md)
9. [从现象到根因的分层观测方法](./09-从现象到根因的分层观测方法.md)

## 3. 最小扰动原则

先使用已有低成本计数器和静态 tracepoint，再考虑高频 kprobe、全量 syscall trace 或内存 dump。观测会消耗 CPU、内存、网络和磁盘，也可能改变调度时序；任何生产采集都要声明范围、持续时间、过滤条件和停止方式。

## 4. 官方资料

- [Linux 内核 Tracing 文档](https://docs.kernel.org/trace/index.html)
- [ftrace 文档](https://docs.kernel.org/trace/ftrace.html)
- [BPF 文档](https://docs.kernel.org/bpf/index.html)
- [Perf 安全与权限](https://docs.kernel.org/admin-guide/perf-security.html)

下一篇：[指标、日志、Trace 与 Profile 的边界](./01-指标日志Trace与Profile的边界.md)
