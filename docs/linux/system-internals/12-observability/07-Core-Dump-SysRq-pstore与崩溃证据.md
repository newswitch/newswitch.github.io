---
title: "Core Dump、SysRq、pstore 与崩溃证据：系统死前还能留下什么"
sidebar_label: "07. Core Dump、SysRq 与 pstore"
sidebar_position: 7
description: "区分用户态 core、内核 vmcore、任务栈、pstore/ramoops、watchdog 与安全采集边界。"
tags: [Linux, Core Dump, SysRq, pstore, Crash]
---

# Core Dump、SysRq、pstore 与崩溃证据：系统死前还能留下什么

崩溃分析依赖故障前已配置的保存通道。系统完全失去调度、磁盘或网络后再临时启用采集，往往已经来不及。

## 1. 证据分类

| 故障 | 证据 |
|---|---|
| 用户进程崩溃 | core dump、binary、shared libraries、Build ID、日志 |
| 线程卡死/系统仍响应 | task stack、SysRq、perf/ftrace、应用 dump |
| kernel panic | serial console、pstore、kdump vmcore |
| 突然复位/掉电 | BMC SEL、pstore、firmware/硬件日志、远端监控 |

## 2. 用户态 Core

`RLIMIT_CORE`、`core_pattern`、dumpable、存储空间和 systemd-coredump 共同决定是否保存。core 可能包含密钥、用户数据和模型内容，应限制访问、保留期和上传。

```bash
ulimit -c
cat /proc/sys/kernel/core_pattern
coredumpctl list 2>/dev/null
```

分析必须匹配精确可执行文件和库，不能拿升级后的 binary 符号解释旧 core。

## 3. SysRq

Magic SysRq 可输出任务、内存、锁等状态或触发同步/重启。它可能产生海量 console 输出甚至执行破坏性动作；只在预先授权、明确 key 含义和有可靠 console 的情况下使用。

## 4. pstore/ramoops

pstore 可把 panic/oops/console 片段写入固件或预留 RAM 后端，重启后从 `/sys/fs/pstore` 读取。容量通常很小，要配置优先级、压缩和轮转。

## 5. kdump

panic 后 kexec 进入 capture kernel，由它读取保留的崩溃内存并写 vmcore。需要提前预留 crashkernel、准备独立存储/网络路径并定期演练。

## 6. 练习与答案

**问题：启用了 core size unlimited，是否一定有 core 文件？**

答案：不一定。core_pattern、dumpable、目录权限/空间、systemd-coredump、容器和信号类型都影响结果。

**问题：panic 后普通磁盘日志一定完整吗？**

答案：不一定。page cache 未落盘、文件系统不可用或 panic 路径无法执行常规写入，因此要配置串口、pstore 或 kdump。

下一篇：[时间同步、关联标识与证据可信度](./08-时间同步关联标识与证据可信度.md)
