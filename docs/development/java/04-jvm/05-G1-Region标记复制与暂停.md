---
title: "G1：Region、标记、复制与暂停"
sidebar_label: "05. G1：Region、标记、复制与暂停"
sidebar_position: 5
description: "理解 G1 的 Region、年轻代、并发标记、Mixed GC、Remembered Set 与大对象路径，并通过有界分配程序读取日志。"
tags: [Java, JVM, G1, GC, JDK25]
---

# G1：Region、标记、复制与暂停

G1 的核心不是“把堆平均分块后就不暂停”，而是利用 Region 组织回收范围，用历史成本估算本次能处理多少工作。它兼顾吞吐和暂停，但不是硬实时收集器。本文讨论 JDK 25 HotSpot；默认选择也应从目标 JVM 日志确认。

## 1. Region 怎样代替固定连续分代

堆由相同大小的 Region 组成，Region 可以承担 Eden、Survivor、Old 等角色。年轻代仍然存在，只是不必在地址空间中是一整块连续区域；角色会随着运行变化。

回收集合 CSet 是本次准备回收的 Region 集合。复制其中的存活对象到其他 Region、修正引用后，源区域可整体再用。低存活比例的区域通常更划算，但选择还受到依赖、空间和暂停目标约束。

## 2. 从 Young 到 Mixed 的主路径

```text
普通 Young GC
→ Young GC 同时启动并发标记
→ 与应用并行的标记工作
→ Remark / Cleanup 等暂停与整理
→ Prepare Mixed
→ 多次 Mixed GC：年轻代 + 部分老年代
→ 返回年轻代为主的阶段
```

并发标记确定老年代中哪些对象仍存活，不等于当场把所有老年代垃圾都搬走。Mixed 逐次加入合适的老 Region，避免每次都全堆处理。具体阶段边界以 [G1 官方机制说明](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)为准。

## 3. 为什么只回收一部分仍能找到外部引用

老对象可能引用年轻对象，没被选中的 Region 也可能引用本次 CSet。若每次都扫描整个堆，局部回收就失去意义。

写屏障及卡表等结构记录必要的引用变化，Remembered Set 帮助查找从外部进入回收集合的引用。并发标记还通过相应屏障维持一致的存活性视图。它们不是免费功能：维护元数据、扫描引用和复制对象都会消耗 CPU 与内存。

两类记录解决的问题不同：SATB，Snapshot-At-The-Beginning，在并发标记中保留必要的旧引用信息，避免应用改写引用时漏掉快照语义下应保留的对象；跨区引用记录则帮助后续局部回收定位进入集合的引用。前者不等于给堆拍一张完整副本，后者也不意味着每次写字段都立刻全堆扫描。JDK 补丁可能优化屏障实现，但这两个责任应分开理解。

因此“对象数量一样”不保证暂停一样。对象大小、存活比例、跨区引用密度和 CPU 配额都可能改变成本。

## 4. 一个不会故意 OOM 的分配实验

```java title="GcWorkload.java"
import java.util.Arrays;

public class GcWorkload {
    private static volatile Object sink;

    public static void main(String[] args) {
        byte[][] retained = new byte[16][];
        for (int i = 0; i < 4096; i++) {
            byte[] block = new byte[64 * 1024];
            Arrays.fill(block, (byte) i);
            retained[i % retained.length] = block;
            sink = block;
        }
        System.out.println("allocatedMiB=256");
        System.out.println("retainedBlocks=" + retained.length);
        System.out.println("lastByte=" + retained[15][0]);
    }
}
```

在一个新的实验目录执行，日志文件只属于本次实验：

```bash
javac --release 25 -d out GcWorkload.java
java -Xms64m -Xmx64m -XX:+UseG1GC -Xlog:gc*,safepoint:file=g1.log:uptime,level,tags -cp out GcWorkload
```

应用确定性输出如下，GC 次数和耗时不是确定性结果：

```text title="expected-output"
allocatedMiB=256
retainedBlocks=16
lastByte=-1
```

总计分配 256 MiB 不代表同时持有 256 MiB；环形数组只保留最近 16 块，另有少量执行临时对象。`volatile sink` 使对象可观察，减少实验被整体消除的可能。短实验用于验证日志链路，不保证触发 Mixed GC。

## 5. 逐项读一行日志

以下是格式示意，数值不是性能承诺：

```text
[0.120s][info][gc] GC(2) Pause Young (Normal) (G1 Evacuation Pause) 38M->2M(64M) 1.800ms
```

`GC(2)` 是事件编号；`Pause Young` 说明本行是年轻代暂停；`38M->2M` 是该事件前后堆占用，括号是当前堆容量，不必等于所有场景下的最大堆。末尾时间是暂停，而不是两次 GC 间隔。

继续查同一事件的 `gc+phases`、`gc+heap` 和 `gc+cpu`。复制时间高要看存活对象；扫描时间高看引用结构；Real 远高于 CPU 时间时还要检查抢占、限流及系统环境。

## 6. 大对象和空间失败为何特殊

达到至少半个 Region 大小的对象会进入 Humongous 路径；应按完整对象大小而不只按数组有效载荷判断。它可能需要连续 Region，并带来尾部浪费和碎片问题。小实验的 64 KiB 块特意不针对这个路径。

Evacuation Failure 表示搬迁存活对象时受阻，需要查看具体原因和日志；后备 Full GC 可能带来更长暂停。即使总空闲量看起来足够，大对象所需连续区域或搬迁目标空间仍可能不足。

## 7. 参数如何形成可验证假设

先固定负载、堆和日志，再一次修改一个因素：

| 参数或改动 | 意图 | 必须复核的代价 |
| --- | --- | --- |
| `-XX:MaxGCPauseMillis=100` | 调整暂停目标 | 不是 100 ms 上限，频率与吞吐可能变化 |
| 调整 `-Xmx` | 增加空间与回收余量 | RSS、容器预算、长期存活量 |
| 减少临时大数组 | 降低分配与大对象压力 | 是否转为长期缓存并扩大存活集 |
| 调整并发资源 | 让标记及时完成 | CPU 配额和应用竞争 |

不要一开始固定年轻代大小或复制一串“万能 G1 参数”。这可能约束其自适应能力。更具体的权衡见 [G1 调优指南](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html)。

## 8. 练习与答案

### 8.1 Mixed GC 是不是只回收老年代

不是，它同时包含年轻代和部分老年代 Region。它也不是每次把整个老年代清空。

### 8.2 暂停目标改为 10 ms，为什么请求仍有 300 ms

目标不是硬保证；请求还可能等待队列、CPU、锁、连接和下游。先把同一时间窗的请求、GC、安全点和系统证据对齐，再归因。

### 8.3 分配 256 MiB 却在 64 MiB 堆中完成，是否绕过 Xmx

没有。Xmx 约束同时存在的堆容量，不限制进程生命周期累计分配量。短命对象被回收后，空间可以重复使用。

## 9. 继续阅读

- [ZGC 分代、屏障与并发回收](./06-ZGC分代屏障与并发回收.md)
- [GC 日志、安全点与延迟归因](../06-diagnostics/05-GC日志安全点与延迟归因.md)
