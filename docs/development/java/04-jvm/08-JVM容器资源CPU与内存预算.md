---
title: "JVM 容器资源、CPU 与内存预算"
sidebar_label: "08. JVM 容器资源、CPU 与内存预算"
sidebar_position: 8
description: "结合 Linux cgroups 与 Kubernetes 解释 JVM 可见 CPU、堆百分比、非堆预算、限流和 OOMKilled，不把 Xmx 当成容器内存。"
tags: [Java, JVM, Kubernetes, cgroups, 容量]
---

# JVM 容器资源、CPU 与内存预算

具体指标名、采集口径、PromQL 与告警边界见[核心监控指标采集与告警](./10-JVM核心监控指标采集与告警.md)；本篇保留原有运维与机制主线。

宿主机有 64 核、256 GiB，不代表 Pod 内的 JVM 能持续获得这些资源。Linux 容器通过 cgroups 等机制约束进程，JVM 还会根据自己观察到的资源选择线程数、堆和 GC 行为。

本篇 Linux/cgroups 命令需在目标 Linux 容器或节点执行；Windows 原生实验只验证 Java 参数，不冒充实际 Kubernetes 限流结果。

## 1. requests、limits 与 JVM 各管什么

Kubernetes requests 主要参与调度和资源分配；CPU limit 可形成带宽约束；memory limit 约束相应 cgroup 的内存使用。它们不是 `-Xmx` 的另一种写法。

现代 HotSpot 在支持的平台具有容器感知能力，但发行版、JDK 补丁、cgroup 版本和嵌套层级会影响识别。先观察，再设参数：

```bash
java -XshowSettings:system -version
java -XshowSettings:vm -version
java -Xlog:os+container=trace -version
java -XX:+PrintFlagsFinal -version
```

检查实际使用的 JDK，必要时再过滤 `UseContainerSupport`、`MaxHeapSize`、`MaxRAMPercentage`、`ActiveProcessorCount`。参数定义见 [JDK 25 java 手册](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html)。

## 2. 可见处理器数量不等于保底 CPU

`Runtime.availableProcessors()` 是 JVM 暴露给应用的处理器数量，库可能据此决定并行度。它不是监控中“当前获配 100% 算力”，也不能完整表达分数核配额与调度竞争。

```java title="CpuBudgetDemo.java"
public class CpuBudgetDemo {
    public static void main(String[] args) {
        System.out.println("processors=" + Runtime.getRuntime().availableProcessors());
    }
}
```

```bash
javac --release 25 -d out CpuBudgetDemo.java
java -XX:ActiveProcessorCount=2 -cp out CpuBudgetDemo
```

```text title="expected-output"
processors=2
```

这个选项覆盖 JVM 使用的处理器数量，不把物理 CPU 绑成两核，也不会替容器修改配额。它适合校正已确认的并行度问题，不能用来证明真实吞吐能力。

## 3. CPU 不高，为什么延迟仍因限流增加

短窗口内可运行线程会争用配额，配额耗尽后需要等待下一个周期。较长时间平均的宿主机 CPU 可能不高，目标 Pod 却已经出现明显 throttling。

在目标 cgroup v2 的实际路径中读取，下面路径只适用于进程所在容器恰好把该 cgroup 作为挂载根的情况：

```bash
cat /proc/self/cgroup
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.events
```

`cpu.max` 示例 `200000 100000` 表示每 100000 微秒周期允许 200000 微秒 CPU 时间，约为两核带宽。`cpu.stat` 中 `nr_throttled`、`throttled_usec` 应看区间增量，不能把开机累计值当成本次故障。cgroup v1 文件名与语义有所不同，应按挂载和 [内核 cgroup v2 文档](https://docs.kernel.org/admin-guide/cgroup-v2.html)核对。

## 4. 内存预算先给非堆留下空间

假设一个实验 Pod 限制 2 GiB，可以先建立下面的测量表，而不是直接 `-Xmx2g`：

| 预算项 | 需要测量的峰值 |
| --- | --- |
| Java 堆 | 稳态存活量、突发与回收余量 |
| Metaspace、Code Cache、GC 结构 | 类数量、编译与收集器开销 |
| 平台线程、Direct Buffer、本地库 | 线程和连接并发、缓冲池上限 |
| 页面、映射与安全余量 | OS/cgroup 计费口径与真实峰值 |

若已测出非堆和峰值需约 700 MiB，给堆分配 1.8 GiB 就明显超预算。这里的 700 MiB 只是算例，不是推荐默认值。

`MaxRAMPercentage` 参与自动堆上限选择，不代表进程总内存比例。显式 `-Xmx` 会改变这套自动选择的结果；小内存配置还涉及其他 ergonomics，最终以有效 `MaxHeapSize` 为准。

## 5. OOMKilled 与 Java OOM 不同

```bash
kubectl describe pod app-0 -n app
kubectl logs app-0 -n app --previous
kubectl get pod app-0 -n app -o jsonpath='{.status.containerStatuses[*].lastState.terminated}'
```

Pod 的 OOMKilled、cgroup 的 `oom_kill` 增量、节点事件及时间应互相对应。退出码 137 常与 SIGKILL 有关，但单凭 137 不能排除人工终止等其他原因。

Java 抛 `OutOfMemoryError` 时可能有堆转储；内核终止进程时通常来不及触发 JVM 的 OOM 钩子。看到“没有 heap dump”不能反证内存没问题。

## 6. 配置变化需要怎样验证

保持负载与输入一致，观察 CPU 限流增量、线程池排队、GC、RSS/cgroup 内存峰值和错误率。修改 CPU limit 可能同时改变 GC 并行度和公共线程池行为；修改 Xmx 又可能改变收集频率和非堆余量。因此一次大幅同时改五个参数，很难证明哪个因素真正有效。

## 7. 练习与答案

### 7.1 CPU limit=2，是否应该把所有线程池都设为 2

不是。计算型、阻塞型和外部资源受限任务不同，还要看等待比例、连接池、队列和取消。线程数不是单纯复制 CPU 数量。

### 7.2 堆使用只有 50%，容器是否不会 OOMKilled

不能保证。非堆、直接内存、本地库、线程及其他计费项仍可能把 cgroup 推到限制，必须看整体峰值。

### 7.3 在 Windows 上设置 ActiveProcessorCount，能验证 Linux CPU throttling 吗

不能。它验证 JVM 可见处理器数量的覆盖效果；限流是 OS/cgroup 机制，需在真实 Linux 约束中观察。

## 8. 继续阅读

- [运行时内存、堆外与进程 RSS](./03-运行时内存堆外与进程RSS.md)
- [CDS、AppCDS 与 AOT 缓存](./09-CDS-AppCDS与AOT缓存.md)
