---
title: "内存增长、GC 抖动与容器 OOM"
sidebar_label: "09. 内存、GC 与 OOM"
sidebar_position: 9
description: "区分 Java heap、非堆、RSS 与 cgroup 使用，建立对象保留、分配抖动、堆外增长和 OOMKill 的不同证据路径。"
tags: [SpringBoot, JVM, GC, OOM]
---

# 内存增长、GC 抖动与容器 OOM

堆用了 500MB、容器用了 900MB，不代表多出的 400MB 一定是泄漏。JVM 不是只有堆，容器统计也不是只看 Java 活对象。

## 1. 四个数不能混看

堆使用量描述相应 Java 堆状态；堆 committed 是已提交容量；进程 RSS 是驻留页；cgroup 使用量还可能包括按其规则计入的缓存等。不要用容器总内存减堆使用量，直接命名为“泄漏字节”。

![JVM 进程内存与容器边界](/img/development/jvm-memory.svg)

图中不同区域表达归属，不按面积表示真实容量；线程栈、元空间、直接内存与本地库可能随线程数、类和连接增长。

## 2. 先区分退出原因

Java 抛 OutOfMemoryError 可能是 heap、metaspace、直接缓冲或线程创建失败；内核 OOMKill 可能让进程来不及打印 Java 异常。Kubernetes 看到 137 也不能独立证明原因，需结合 terminated reason、事件和节点/cgroup 证据。

```bash
kubectl describe pod <pod> -n <namespace>
kubectl logs <pod> -n <namespace> --previous
```

只读命令需要替换目标，且日志是否仍存在取决于重启和保留。不要为制造证据故意打爆生产 Pod。

## 3. 堆保留与高分配率

GC 后存活基线上升，考虑无界缓存、队列、未完成 Future、静态集合和会话；分配率高但回收后基线稳定，可能是短命对象风暴而非长期泄漏。两者都能导致延迟，但优化方向不同。

使用 JFR 看分配热点与 GC；需要 heap dump 时先评估暂停、磁盘和敏感数据。对象数量多不是定罪，要沿 dominator/retained size 和 GC Roots 找真正保留链。

## 4. 非堆与线程

NMT 需按 JDK 能力在启动配置，baseline/diff 观察变化：

```bash
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

没有启用时不能指望事后补出完整历史，且 NMT 不是所有第三方 native 分配的绝对全量账本。线程持续增多、客户端不关闭、直接缓冲和本地库都需单独核验。

## 5. Boot 常见诱因

无限异步队列、SSE 断连不取消、把大上传 getBytes、全表查 List、JPA 上下文长期保留、每请求创建客户端，以及高基数指标都可能增长内存。对应修复应加上有界资源和生命周期，而不是只调大 Xmx。

Xmx 必须给非堆、线程、缓冲和运行余量留空间；提高堆比例可能反而更容易触发容器 OOM。CPU throttling 也可能使 GC 跟不上分配。

## 6. 验证

按稳定负载、突发和断连场景测分配率、GC 后活对象、线程、队列、RSS、cgroup 和退出原因。修复后多轮负载应回到合理基线，不用一次 GC 后短暂下降宣称泄漏已根治。

本文不包含故意触发 OOM 的生产实验。已有有界诊断示例见 [Heap 与 Native Memory](../../java/06-diagnostics/04-Heap-NativeMemory与OOM排查.md)。

## 7. 练习与答案

### 7.1 堆空闲很多为什么仍 OOMKill

可能非堆、线程、本地分配或其他 cgroup 计入内存超限，需要看整体证据。

### 7.2 GC 后下降说明没有泄漏吗

不充分，部分对象可回收同时仍有保留基线增长，要观察长期趋势与保留链。

### 7.3 先把 Xmx 调到 limit 的 95% 合理吗

不能作为默认方案，几乎不留非堆和运行余量，需按真实预算验证。

## 8. 深入

- [运行时内存与 RSS](../../java/04-jvm/03-运行时内存堆外与进程RSS.md)
- [JDK 25 jcmd](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)
