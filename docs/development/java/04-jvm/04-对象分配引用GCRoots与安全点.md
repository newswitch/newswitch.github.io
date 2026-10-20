---
title: "对象分配、引用、GC Roots 与安全点"
sidebar_label: "04. 对象分配、引用、GC Roots 与安全点"
sidebar_position: 4
description: "沿对象创建、TLAB 分配、可达性分析、引用处理与回收理解 GC，澄清逃逸分析、循环引用和安全点误区。"
tags: [Java, JVM, TLAB, GC, Safepoint]
---

# 对象分配、引用、GC Roots 与安全点

GC 并不判断“业务还想不想要这个对象”，而是按可达性和引用语义管理对象。一个已经无用、却仍被全局 Map 引用的对象通常不能回收；两个彼此引用、但从根不可达的对象则可以回收。

## 1. new 之后发生了什么

普通对象创建涉及类型准备、取得内存、必要的零值初始化、对象头及字段状态、构造器调用。实际操作会被优化和重排，但必须满足语言与内存模型的可观察约束；不能把某段伪代码的顺序当成所有 CPU 的最终指令。

HotSpot 的常见对象布局包括对象头、实例字段及对齐填充。头大小受压缩引用、压缩类指针、Compact Object Headers 等设置影响，字段还会布局调整。不能把“每个对象固定 16 字节头”当成 JDK 25 定律；测量要记录完整配置，详细性能机制可参见 [HotSpot 实现说明](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html)。

## 2. TLAB 为什么降低分配竞争

多个线程如果对同一分配指针竞争，每次分配都要协调。TLAB 是线程在堆中使用的一小块本地分配缓冲区：在缓冲区内常可通过移动指针快速分配；耗尽后再申请或走其他路径。

TLAB 仍属于 Java 堆，不是线程栈。大对象、不同收集器或缓冲区剩余不足时，分配路径可能不同。分配很快也不意味着免费：触页、对象初始化、存活对象扫描和后续回收仍有成本。

## 3. 逃逸分析不等于把对象都搬到栈

编译器分析对象是否逃出方法或线程，可能进行标量替换、消除分配及某些锁优化。例如只用一个临时坐标对象计算结果，优化后可能只保留两个数值，连完整对象都不必建立。

这不是承诺“所有局部对象都栈上分配”。对象是否逃逸、是否能消除，受控制流、调用是否内联和编译器能力影响；调试或关闭优化也可能改变观察结果。业务正确性不能依赖对象一定被消除。

## 4. 从根出发，而不是数互相引用的次数

![GC Roots 强可达链与没有根路径的对象环](/img/development/gc-reachability.svg)

上方缓存仍被根持有时，其数据也可能持续保留；下方两个对象互相引用却没有根路径，循环本身不妨碍可达性回收。

根的来源可包括活跃线程栈中的有效引用、静态状态所保留的可达路径、JNI 句柄和 JVM 内部引用等。工具中的根类别是具体实现视角。

```text
长期存活的注册表
→ Listener
→ 请求上下文
→ 大型结果集

本次请求已结束，但注册表未移除 Listener
→ 整条链仍可能可达
```

排查泄漏时寻找“为什么还可达”，而不是只看哪个类实例最多。缓存本来就要持有对象，是否泄漏还要看业务上限、过期规则和预期生命周期。

## 5. 强、软、弱、虚引用怎样不同

| 引用 | 适合的理解 | 不该依赖的保证 |
| --- | --- | --- |
| 强引用 | 正常持有和访问对象 | 方法结束时立即释放物理页 |
| 软引用 | GC 按规则决定清理的特殊引用 | 稳定容量或稳定命中率的缓存 |
| 弱引用 | 不阻止弱可达对象被回收 | 下一毫秒必定变 null |
| 虚引用 | 配合 ReferenceQueue 做回收后处理协调 | 用 get 重新拿回对象 |

下面只验证显式清除与入队，不把不确定的 GC 时机伪装成确定输出：

```java title="ReferenceDemo.java"
import java.lang.ref.Reference;
import java.lang.ref.ReferenceQueue;
import java.lang.ref.WeakReference;

public class ReferenceDemo {
    public static void main(String[] args) {
        Object value = new Object();
        ReferenceQueue<Object> queue = new ReferenceQueue<>();
        WeakReference<Object> weak = new WeakReference<>(value, queue);
        System.out.println("same=" + (weak.get() == value));
        weak.clear();
        System.out.println("cleared=" + (weak.get() == null));
        System.out.println("manuallyEnqueued=" + weak.enqueue());
        System.out.println("queueContainsReference=" + (queue.poll() == weak));
        Reference.reachabilityFence(value);
    }
}
```

```bash
javac --release 25 -d out ReferenceDemo.java
java -cp out ReferenceDemo
```

```text title="expected-output"
same=true
cleared=true
manuallyEnqueued=true
queueContainsReference=true
```

队列拿到的是引用对象，不是可复活的原始对象。数据库连接、文件和锁仍应显式关闭，不能依赖弱引用、Cleaner 或 GC 及时完成业务资源释放。

## 6. 安全点与并发 GC 为什么能共存

JVM 做某些全局操作，需要线程到达可安全观察状态的位置。进入安全点所花的等待时间与安全点内执行操作的时间不同；GC 暂停只是安全点用途之一。

并发收集器让部分 GC 工作与应用同时进行，通过屏障等机制协调引用变化，但仍可能有短暂停顿。线程局部握手机制允许一些操作只协调特定线程，也不意味着所有运行时工作都不再需要全局暂停。

```bash
java -Xlog:gc*,safepoint:file=runtime.log:time,uptime,level,tags -jar app.jar
```

观察日志时把到达安全点、暂停原因、暂停时间分开。不要把一个 GC 周期从开始到结束的墙钟时间全部当作应用停顿。

## 7. 对象年龄与晋升不是固定流水线

在分代收集器中，存活对象可能从年轻代进入老年代，但年龄阈值、空间压力及大对象路径会改变行为。不是所有对象都必须经过固定次数 Young GC；也不是“放到老年代就永久不回收”。下一篇会把这些过程放入 G1 的 Region 中观察。

## 8. 练习与答案

### 8.1 a 与 b 互相引用，是否一定泄漏

不是。如果整个对象组从根不可达，基于可达性的收集器能够回收。若其中一个仍被全局注册表引用，才需要沿路径分析为何保留。

### 8.2 TLAB 用完，是否说明整个堆满了

不是。可能只需重新申请一个缓冲区，也可能转到其他分配路径；要结合堆余量和具体 GC 日志判断。

### 8.3 System.gc 返回后，弱引用是否一定已清空

不能依赖。它是显式 GC 请求，具体行为受实现、参数和对象可达性等影响，不是适合编写稳定业务逻辑或确定性测试的清理时钟。

## 9. 继续阅读

- [G1 Region、标记、复制与暂停](./05-G1-Region标记复制与暂停.md)
- [GC 日志、安全点与延迟归因](../06-diagnostics/05-GC日志安全点与延迟归因.md)
