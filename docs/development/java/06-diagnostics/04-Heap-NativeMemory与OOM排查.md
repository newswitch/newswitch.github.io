---
title: "Heap、Native Memory 与 OOM 排查"
sidebar_label: "04. Heap、Native Memory 与 OOM 排查"
sidebar_position: 4
description: "按退出方式、错误类型和内存区域定位故障，解释直方图、Dominator、GC Roots、NMT 差分与容器内存证据。"
tags: [Java, JVM, OOM, NMT, 内存泄漏]
---

# Heap、Native Memory 与 OOM 排查

内存问题首先要问“哪一种内存、由谁判定不足”。Java 堆耗尽、直接内存达到限额、线程创建失败、native 分配失败和容器 OOMKilled，不能统一用“加大 Xmx”处理。

## 1. 先保留完整错误和退出现场

记录 PID、JDK、启动参数、容器限制、时间、退出码和最早的完整错误。应用仍活着时，先查询区域与趋势；已经退出时，先看上一次日志、容器状态、OS 事件和现有文件，不能再对新 PID 的进程采样后声称是旧故障现场。

| 证据 | 主要方向 | 不足以单独证明 |
| --- | --- | --- |
| `Java heap space` | 堆分配与存活集 | 一定是泄漏 |
| `Metaspace` | 类元数据和加载器 | 单个业务对象过大 |
| direct buffer memory 相关 OOM | 直接缓冲区及其限额 | 所有 native 内存都受同一限额 |
| `unable to create native thread` | 线程数、栈、OS/cgroup 限制 | 必须增加 Java 堆 |
| native allocation 失败及 hs_err | native 区域与系统余量 | 堆转储能覆盖全部原因 |
| OOMKilled / `oom_kill` 增量 | cgroup 总体内存 | JVM 必定来得及写 dump |

错误文本随版本与调用路径变化，应保存原文，不只截取最后一行。

## 2. 堆使用增长，要看 GC 后与相同负载

典型锯齿是正常分配与回收。更值得追踪的是相似负载下回收后基线持续抬高、对象数量与业务生命周期脱节。

“缓存预热后稳定在 1 GiB”和“请求结束后上下文永久挂在静态 Map”都会增长，但前者不一定泄漏。要核对缓存容量、过期、并发在途量、任务队列和数据集是否变化。

最轻一轮可查询：

```bash
jcmd 12345 GC.heap_info
jcmd 12345 VM.classloader_stats
jcmd 12345 VM.native_memory summary scale=MB
```

NMT 需要启动时开启。逐次在相同负载阶段比较，比对某一时刻“已使用 80%”更有解释力。

## 3. 直方图与堆转储不是同一张证据

类直方图回答各类对象数量及浅大小的聚合；堆转储保留更多对象与引用关系，可进一步分析拥有者和保留路径。它们都不能直接展示全部 native 数据。

在确认影响、磁盘空间、权限与证据目录之后，才考虑：

```bash
jcmd 12345 help GC.class_histogram
jcmd 12345 help GC.heap_dump
jcmd 12345 GC.class_histogram
jcmd 12345 GC.heap_dump /var/secure-diagnostics/incident-heap.hprof
```

目录需事先由运维按权限创建；路径是在目标环境解析。以上后两条可能高影响，不在每个副本同时执行。是否请求 GC、是否纳入不可达对象以及是否覆盖已有文件，按目标 help 和选项决定，不能视为无副作用查询。

可以预先为 Java OOM 配置：

```bash
java -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/secure-diagnostics -jar app.jar
```

必须保证可写空间及唯一文件策略。磁盘耗尽、内核强杀、native 崩溃等情形下，不保证生成完整 dump。这是证据预案，不是内存故障的修复。

## 4. 用浅大小、保留大小和根路径解释责任

浅大小是对象本身；Retained Size 表示移除特定对象及其独占保留关系后可能释放的对象集合大小。Dominator 表达一条对象可达关系的支配性质，不是“这个 Java 类所有对象总量”。

离线用 Eclipse MAT 等工具可以按以下顺序分析：

1. 核对文件、时间、JDK 和是否完整可读。
2. 先看大类和大数组，再看 Dominator Tree 中的大保留者。
3. 对可疑对象查到 GC Roots 的路径，区分强引用与特殊引用。
4. 将链路对应回实际业务生命周期，证明该引用应该何时移除。
5. 修复后以相同负载运行足够长，验证存活量与业务结果。

例如 `static registry → listener → request → byte[]` 支持“未注销 listener 保留请求”的假设。仅仅发现 `byte[]` 占比高，不能判断它属于缓存、网络缓冲还是上传内容。MAT 的分析入口见 [官方文档](https://help.eclipse.org/latest/topic/org.eclipse.mat.ui.help/welcome.html)。

## 5. native 增长用差分缩小范围

启动时启用 `-XX:NativeMemoryTracking=summary`，在状态稳定时设基线：

```bash
jcmd 12345 VM.native_memory baseline
jcmd 12345 VM.native_memory summary.diff scale=KB
jcmd 12345 Compiler.codecache
jcmd 12345 VM.classloader_stats
```

差分示意：

```text
Thread (reserved=... +..., committed=... +...)
Class  (reserved=... +..., committed=... +...)
```

示意不含伪造的具体测量值。Thread 增长时查平台线程与栈；Class 增长时查加载器；其他区域结合应用组件。NMT 没覆盖的第三方分配，需用 OS 映射、分配器和 native 工具继续查，不能因为 summary 稳定就排除。

## 6. 修复要对应生命周期，不只扩容

队列无限增长要加入口边界和取消；缓存要定义容量和过期；类加载器泄漏要释放注册和线程引用；直接缓冲池要约束容量并正确归还；平台线程增长要找创建者与关闭者。

临时扩容可能争取时间，但应验证整体容器预算，并保留导致增长的负载与引用证据。重启后数值归零，只说明进程状态被清空，不证明泄漏已修好。

## 7. 练习与答案

### 7.1 dump 中最大的是 byte[]，能直接认定是上传接口吗

不能。要沿引用关系找到实际持有者，再与接口、缓存和生命周期对应。相同数组类型可能服务完全不同用途。

### 7.2 堆扩大两倍后暂时不报错，能否关闭问题

还不能。若存活基线继续同速增长，只是延迟失败；若是合理数据集扩大并稳定，则可能是容量问题。两者需要长期、同负载证据区分。

### 7.3 为什么不把 heap dump 上传到公开仓库便于讨论

它可能包含凭据、用户数据和业务内容。应该在受控位置分析，公开文章只保留脱敏后的结构、统计和结论。

## 8. 继续阅读

- [内存泄漏官方诊断指南](https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshooting-memory-leaks.html)
- [运行时内存、堆外与进程 RSS](../04-jvm/03-运行时内存堆外与进程RSS.md)
- [GC 日志、安全点与延迟归因](./05-GC日志安全点与延迟归因.md)
