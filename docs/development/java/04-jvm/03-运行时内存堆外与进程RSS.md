---
title: "运行时内存、堆外与进程 RSS"
sidebar_label: "03. 运行时内存、堆外与进程 RSS"
sidebar_position: 3
description: "把堆、线程栈、Metaspace、Code Cache、Direct Buffer 与操作系统内存口径对应起来，解释堆不满但进程超限。"
tags: [Java, JVM, 内存, RSS, NMT]
---

# 运行时内存、堆外与进程 RSS

`-Xmx2g` 限制的是 Java 堆上限，不是 Java 进程只能使用 2 GiB。一个运行中的服务还需要线程栈、类元数据、机器码、GC 辅助结构、直接缓冲区和本地库内存。只看 Heap Used，很容易漏掉真正接近容器限制的部分。

## 1. 先分规范概念与 HotSpot 实现

JVM 规范描述堆、方法区、运行时常量池、线程栈等逻辑区域；HotSpot 通过具体的数据结构和地址空间实现。Metaspace 是其存放类元数据的重要实现，不能把规范“方法区”与某一个内存数字完全画等号。

```text
Java 进程地址空间
├── Java Heap：对象、数组等
├── Metaspace / Class Space：类元数据等
├── Code Cache：JIT 编译代码及相关结构
├── 线程栈：平台线程执行所需栈空间
├── Direct / Native：直接缓冲区、本地库分配等
└── JVM 自身、映射文件、共享库及其他区域
```

引用放在某个栈帧中，不代表被引用的对象也在该帧中。虚拟线程的栈块通常由堆中对象承载，不能用“虚拟线程数 × 平台线程 Xss”估算全部开销。

## 2. 每个区域应看什么

| 区域 | 典型内容 | 常用证据与边界 |
| --- | --- | --- |
| Heap | 对象、数组、缓存、任务 | Heap Used、GC 后存活量、堆转储 |
| 平台线程栈 | 帧和调用状态 | 线程数、`-Xss`、native thread 错误 |
| Metaspace | 类型元数据 | 类数量、加载器统计、NMT |
| Code Cache | 热点机器码 | `Compiler.codecache`、编译事件 |
| Direct Buffer | NIO 直接内存 | BufferPool MXBean、直接内存限额 |
| 其他 native | JNI、本地库、分配器等 | NMT 与 OS 口径交叉，不保证完全可见 |

`-XX:MaxDirectMemorySize` 不限制所有 JNI 或 native 分配；`-XX:MaxMetaspaceSize` 也不是进程堆外总限额。

## 3. reserved、committed、used 与 resident 不相等

Reserved 是预留虚拟地址范围；Committed 是 JVM 已提交、可用的相应内存；Used 是其中已使用部分；RSS 是操作系统观察到的驻留物理页，含义跨到进程和页面层面。

例如堆预留 2 GiB、提交 512 MiB、使用 180 MiB，不等于它已经占用了 2 GiB 物理内存。相反，堆使用下降后 RSS 不立刻下降，也可能是页面仍提交、分配器保留、映射或其他区域增长，而非“GC 没执行”。

NMT 的 committed 不能与 RSS 逐项机械相加对账；共享页、按需触页、映射方式及未跟踪分配都会造成差异。相关限制见 [NMT 文档](https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html)。

## 4. 运行一个固定大小的直接缓冲区示例

```java title="BufferMemoryDemo.java"
import java.lang.management.BufferPoolMXBean;
import java.lang.management.ManagementFactory;
import java.nio.ByteBuffer;
import java.lang.ref.Reference;

public class BufferMemoryDemo {
    public static void main(String[] args) {
        ByteBuffer buffer = ByteBuffer.allocateDirect(4 * 1024 * 1024);
        buffer.putInt(0, 42);
        BufferPoolMXBean pool = ManagementFactory
                .getPlatformMXBeans(BufferPoolMXBean.class).stream()
                .filter(p -> p.getName().equals("direct")).findFirst().orElseThrow();
        System.out.println("direct=" + buffer.isDirect());
        System.out.println("capacity=" + buffer.capacity());
        System.out.println("poolCoversBuffer=" + (pool.getTotalCapacity() >= buffer.capacity()));
        System.out.println("value=" + buffer.getInt(0));
        Reference.reachabilityFence(buffer);
    }
}
```

```bash
javac --release 25 -d out BufferMemoryDemo.java
java -Xmx64m -XX:MaxDirectMemorySize=16m -cp out BufferMemoryDemo
```

```text title="expected-output"
direct=true
capacity=4194304
poolCoversBuffer=true
value=42
```

Buffer 对象本身仍是 Java 对象，实际数据区使用直接内存。`reachabilityFence` 保证观察结束前对象仍被视为可达，不负责手工释放。示例不依赖 GC 何时触发 Cleaner，也没有故意耗尽内存。

## 5. 给一个进程建立内存账本

目标启动时启用 NMT，再在相同 PID 上观察；`12345` 需替换：

```bash
java -XX:NativeMemoryTracking=summary -Xmx512m -jar app.jar
jcmd 12345 GC.heap_info
jcmd 12345 VM.native_memory summary scale=MB
jcmd 12345 VM.native_memory baseline
jcmd 12345 VM.native_memory summary.diff scale=MB
```

最后一条应在经过一段有代表性的相同负载后执行。NMT 有成本，未启动启用时不能指望事后恢复完整历史。

Linux 可同时看：

```bash
ps -o pid,rss,vsz,nlwp,args -p 12345
cat /proc/12345/smaps_rollup
```

`ps` 的 RSS 常以 KiB 展示，VSZ 是虚拟地址大小。Windows 的 Working Set、Private Bytes 与 Linux RSS 不是完全相同指标；不要把名称相近的图直接合并。

## 6. 堆没满仍失败的几条路径

大量平台线程会消耗 native 栈和系统线程资源；大量动态加载器可能耗尽 Metaspace；直接缓冲区可能达到自己的限额；JNI 内存可能推高 RSS；容器还可能因为整体内存被内核终止，来不及抛 Java OOM。

因此排查顺序是先确认退出方式、完整错误和 OS/容器事件，再选堆、线程或 native 的证据。没有 `Java heap space`，不应直接把 `-Xmx` 调到容器上限。

## 7. 练习与答案

### 7.1 Xmx 设成容器 memory limit，是否能最大化利用

通常会挤压其他必需区域及余量，使进程更易被终止。先测量非堆、线程、直接内存和峰值，再留预算；不存在所有服务通用的固定安全百分比。

### 7.2 GC 后 Heap Used 下降但 RSS 不下降，是不是泄漏

不能据此判断。先比较同负载下长期趋势、已提交堆、native 分类及 OS 页面情况，再判断是否存在不应保留的引用或 native 分配。

### 7.3 NMT 总量不涨，RSS 涨，能否排除 native 泄漏

不能。NMT 不覆盖所有第三方 native 分配，需要结合映射、分配器、库行为和 OS 工具继续缩小范围。

## 8. 继续阅读

- [对象分配、引用、GC Roots 与安全点](./04-对象分配引用GCRoots与安全点.md)
- [Heap、Native Memory 与 OOM 排查](../06-diagnostics/04-Heap-NativeMemory与OOM排查.md)
