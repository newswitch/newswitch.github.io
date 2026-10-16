---
title: "JDK 诊断工具、Attach 与证据采集"
sidebar_label: "01. JDK 诊断工具、Attach 与证据采集"
sidebar_position: 1
description: "建立从进程身份到线程、堆、NMT、JFR 的诊断顺序，说明 jcmd、jstat、jstack、jmap 的职责和线上开销边界。"
tags: [Java, JVM, jcmd, Attach, 排障]
---

# JDK 诊断工具、Attach 与证据采集

工具命令成功，不代表证据足以支持结论。先确认目标 JVM、版本、时间窗和问题，再选择最小需要的采集。堆转储、全量直方图和动态增强不是与查询版本等价的“随手看看”。

## 1. 先认进程，再选工具

```bash
java -version
jcmd -l
jps -lv
jcmd 12345 VM.version
jcmd 12345 VM.command_line
jcmd 12345 VM.flags
```

`12345` 替换为目标 PID。Shell 的 `java -version` 只代表当前命令，不保证目标服务使用同一 JDK。命令行可能含凭据，采集前控制权限，分享前脱敏。

Attach 通常要求与目标同机且具备相应用户权限。容器还涉及 PID namespace、临时目录和进程可见性；精简镜像可能没有工具。不能为了 Attach 方便就给业务 Pod 全部特权或把诊断端口暴露到公网。

## 2. 每个工具适合回答什么

| 工具 | 常见职责 | 主要边界 |
| --- | --- | --- |
| `jcmd` | 查询目标支持的命令，采集线程、堆、NMT、JFR 等 | 每个子命令影响不同，以 help 为准 |
| `jps` | 列出可发现的本机 JVM | 看不到不代表进程不存在 |
| `jstat` | 周期观察 JVM 性能计数 | 列和含义受版本、收集器影响 |
| `jstack` | 线程栈快照 | 一次快照不是完整耗时分布 |
| `jmap` | 堆相关信息、直方图或转储 | 部分操作可能很重 |
| `jinfo` | 查看部分配置，部分场景可修改标志 | 不是所有标志都可运行时更改 |
| `javap` | 离线分析 Class | 不反映最终 JIT 机器路径 |
| `jfr` | 离线查看和处理 JFR 文件 | 不是所有事件都默认启用 |

同系列、兼容的 JDK 工具优先。不要从旧文章复制不存在的子命令或把 jstat 的某列当成所有 GC 通用含义。

## 3. 先问目标支持什么

```bash
jcmd 12345 help
jcmd 12345 help Thread.print
jcmd 12345 help GC.heap_dump
jcmd 12345 help JFR.start
```

输出包含语法、选项、影响等级。以 [JDK 25 jcmd 手册](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)和目标进程的帮助共同确认，不能认为一个版本的工具能够无条件控制所有旧进程。

## 4. 有界的本地诊断目标

下面程序最多运行 90 秒，不监听端口；在前台按 Enter 可提前退出。后台线程只做少量计算和分配，供后续章节反复观察：

```java title="DiagnosticTarget.java"
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class DiagnosticTarget {
    private static final CountDownLatch stop = new CountDownLatch(1);
    private static final ByteBuffer direct = ByteBuffer.allocateDirect(1024 * 1024);
    private static volatile int result;
    private static volatile Object latest;

    public static int work(int value) {
        return value * 31 + 7;
    }

    public static void main(String[] args) throws Exception {
        Thread input = Thread.ofPlatform().daemon().name("diagnostic-input").start(() -> {
            try { System.in.read(); } catch (Exception ignored) { }
            stop.countDown();
        });
        Thread worker = Thread.ofPlatform().name("runtime-worker").start(() -> {
            int sequence = 0;
            try {
                while (stop.getCount() != 0) {
                    result = work(sequence++);
                    latest = new byte[16 * 1024];
                    Thread.sleep(25);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        System.out.println("READY pid=" + ProcessHandle.current().pid());
        System.out.flush();
        try {
            stop.await(90, TimeUnit.SECONDS);
        } finally {
            stop.countDown();
            worker.interrupt();
            worker.join(2000);
            direct.putInt(0, result);
        }
        System.out.println("STOPPED");
    }
}
```

```bash
javac --release 25 -d out DiagnosticTarget.java
java -Xms32m -Xmx64m -XX:NativeMemoryTracking=summary -cp out DiagnosticTarget
```

另开终端，用 `READY` 打印的真实 PID 执行后续命令。若标准输入已关闭，程序可能立即退出；这是受控退出行为，不是 Attach 故障。

## 5. 第一轮采集与输出解读

```bash
jcmd 12345 GC.heap_info
jcmd 12345 Thread.print -l
jcmd 12345 Compiler.codecache
jcmd 12345 VM.native_memory summary scale=MB
jstat -gcutil 12345 1000 5
```

下面是 `GC.heap_info` 的示意，不是固定数值：

```text
12345:
 garbage-first heap total 34816K, used 4200K
  region size 1024K, ...
 Metaspace used 900K, committed 1024K, reserved ...
```

Heap 的 total/used、Metaspace 的 used/committed/reserved 不同；线程输出中的 `runtime-worker` 可能正在 sleep，也可能瞬间在计算，不能要求每次栈完全相同。jstat 五次采样是趋势片段，不代表已经涵盖故障高峰。

## 6. 把采集成本排顺序

先做进程身份、有效参数、业务和系统指标；再短时采样 JFR、有限次数线程快照；根据假设再决定直方图、堆转储或动态增强。即使一个命令标为低影响，高频循环采集也可能产生明显开销。

`GC.class_histogram` 和 `GC.heap_dump` 可能暂停应用、触发相关 GC 或产生大文件，选项不同又会改变行为。先读目标 help，评估空间和影响，不作为所有故障的默认第一条。

诊断文件可能含 SQL、请求、密钥及用户数据，应存入有权限和保留周期的目录，不提交到博客源码或公共对象存储。

## 7. 练习与答案

### 7.1 jcmd -l 看不到服务，是否服务已经没了

不能据此确认。检查 OS 进程、用户、namespace 和工具环境。容器内外 PID 不一定相同。

### 7.2 为什么先查 VM.version 而不是直接用当前 java -version

因为进程可能由另一个路径的 JDK 启动。前者询问目标，后者只启动当前 Shell 解析出的 Java。

### 7.3 一个低影响命令能否每 10 ms 跑一次

不应直接这样做。Attach、格式化输出和采集本身会叠加成本；按问题时间尺度选择有限频次，观察效果后再调整。

## 8. 继续阅读

- [JFR 事件、采样与性能画像](./02-JFR事件采样与性能画像.md)
- [线程、锁、CPU 与卡顿定位](./03-线程锁CPU与卡顿定位.md)
