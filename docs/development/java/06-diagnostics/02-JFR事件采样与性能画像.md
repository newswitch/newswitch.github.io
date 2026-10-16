---
title: "JFR 事件、采样与性能画像"
sidebar_label: "02. JFR 事件、采样与性能画像"
sidebar_position: 2
description: "通过有限录制、离线查询和自定义事件掌握 JFR，区分 CPU、等待、分配与存活对象，解释火焰图证据边界。"
tags: [Java, JVM, JFR, Profiling, 性能]
---

# JFR 事件、采样与性能画像

监控告诉我们“某个时间窗变慢了”，Profile 帮助缩小“时间或资源消耗在哪条调用路径”。JFR 是 JDK 内置的事件记录能力，可以关联线程、锁、GC、分配和自定义业务事件。它不是把所有方法调用逐条完整记录下来的录像机。

## 1. 事件、采样、阈值分别控制什么

事件记录发生的事情与字段；采样以有限频率观察执行状态；阈值决定某些持续型事件达到什么条件才记录。默认模板并不启用所有事件，也不捕获所有短等待。

因此没看见某个事件，可能是未启用、低于阈值、时间窗没覆盖或采样没命中，不一定是事情没发生。先保存录制配置，再解释结果。

## 2. 给已有进程录制一个有限时间窗

使用[诊断目标](./01-JDK诊断工具Attach与证据采集.md)，把 PID 替换为真实值；文件路径是在目标 JVM 所在环境解析的：

```bash
jcmd 12345 JFR.start name=incident settings=profile duration=30s filename=incident.jfr maxsize=64m
jcmd 12345 JFR.check
jcmd 12345 JFR.dump name=incident filename=incident-now.jfr
jcmd 12345 JFR.stop name=incident
```

第一条已经设置自动结束；后面三条演示提前检查、转储和停止，应在录制仍运行时使用，不必机械执行到已经不存在的录制。文件名不要与已有证据冲突。

`profile` 比常规低开销配置启用更丰富的信息，但成本取决于事件、频率、线程和负载，不承诺固定小于某个百分比。先在单个受控副本短时验证，参数见 [jcmd 手册](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)。

## 3. 离线先看概况，再按问题过滤

```bash
jfr summary incident.jfr
jfr print --events jdk.ExecutionSample incident.jfr
jfr print --events jdk.JavaMonitorEnter,jdk.ThreadPark incident.jfr
jfr print --events jdk.ObjectAllocationSample incident.jfr
```

summary 展示事件种类、数量和录制时间。不同 JDK/模板的字段和可用事件可能变化，以 `jfr metadata` 和目标配置为准。详细参数见 [jfr 工具手册](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jfr.html)。大文件宜在专门分析机通过 JDK Mission Control 等工具查看，而不是一次打印全部栈淹没终端。

## 4. CPU、Wall、分配和存活不能互换

| 画像 | 主要解释 | 不能直接推出 |
| --- | --- | --- |
| CPU/执行采样 | 正在执行的热点路径 | 某方法占了请求总耗时的相同比例 |
| Wall-clock | 线程在墙钟时间中的执行与等待位置 | 所有等待都是坏事 |
| Allocation | 在哪里产生对象、估计分配量 | 这些对象最后都泄漏 |
| Heap/存活对象 | 采集时保留了哪些对象 | 过去所有瞬时分配路径 |
| Lock/Park 事件 | 竞争、停放和持续时间 | 被等待的一定是内置监视器 |

JFR 的普通执行采样不要直接当成全线程 wall-clock 画像。async-profiler 提供 CPU、wall、alloc 等模式，其环境支持和采样机制见 [官方 ProfilingModes](https://github.com/async-profiler/async-profiler/blob/master/docs/ProfilingModes.md)；这是 Linux/macOS 等支持环境下的扩展工具，不声称在 Windows 上完成了 native profiler 实测。

## 5. 亲自写一个业务事件并读回来

```java title="RecordingDemo.java"
import java.nio.file.Path;
import java.time.Duration;
import jdk.jfr.Event;
import jdk.jfr.Label;
import jdk.jfr.Name;
import jdk.jfr.Recording;
import jdk.jfr.consumer.RecordingFile;

public class RecordingDemo {
    @Name("learning.Task")
    @Label("Learning task")
    static class TaskEvent extends Event {
        @Label("Task number")
        int number;
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("recording path required");
        Path destination = Path.of(args[0]);
        try (Recording recording = new Recording()) {
            recording.enable(TaskEvent.class).withThreshold(Duration.ZERO);
            recording.start();
            for (int i = 1; i <= 2; i++) {
                TaskEvent event = new TaskEvent();
                event.number = i;
                event.begin();
                event.end();
                event.commit();
            }
            recording.stop();
            recording.dump(destination);
        }
        var events = RecordingFile.readAllEvents(destination).stream()
                .filter(e -> e.getEventType().getName().equals("learning.Task")).toList();
        System.out.println("tasks=" + events.size());
        System.out.println("numberSum=" + events.stream().mapToInt(e -> e.getInt("number")).sum());
    }
}
```

```bash
javac --release 25 -d out RecordingDemo.java
java -cp out RecordingDemo tasks.jfr
jfr summary tasks.jfr
jfr print --events learning.Task tasks.jfr
```

Java 程序输出：

```text title="expected-output"
tasks=2
numberSum=3
```

JFR 文件中的开始时刻、持续时间和线程 ID 每次不同；事件数量与字段值才是该实验的稳定断言。`begin/end/commit` 分别确定持续区间与提交，录制对象须关闭。API 行为见 [Recording 文档](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jfr/jdk/jfr/Recording.html)。

本组 Windows、JDK 25.0.4 实验遇到过默认临时仓库路径包含中文时生成 0 字节录制的情况；同一程序切到独立英文路径后正常。遇到空文件时先看 JFR 日志和目录权限，可以做下面的路径对照，而不是只更改最终输出文件名：

```powershell
New-Item -ItemType Directory -Path D:/java-lab/jfr-repository -Force
java -XX:FlightRecorderOptions=repository=D:/java-lab/jfr-repository -cp out RecordingDemo tasks.jfr
```

该目录应是自己创建的专用实验目录。JFR 临时仓库与最终 `.jfr` 目标不是同一个概念；这个实测现象不意味着所有 JDK、所有中文路径都会失败。给长期目标进程录制时，仓库设置应在目标启动时指定。

业务事件适合记录阶段、结果类别和受控标识，不要放入访问令牌、完整提示词或用户原始数据。文件访问权限与保留周期也是诊断的一部分。

## 6. 火焰图为什么不是调用时间线

普通聚合火焰图的宽度表示某种权重，例如 CPU 样本数或分配字节；横向位置通常不是先后顺序。父框包含子框，要区分包含成本与自身成本。

一个 `socketRead` 框在 wall 图中很宽，可能意味着很多正常空闲连接，也可能是关键请求在等待。必须结合线程角色、请求时间窗和下游指标确认。不能看见最高的框就认定它是根因。

## 7. 从画像到改动的闭环

先提出可证伪假设，例如“JSON 编码占应用 CPU 的主要部分”；采集相同负载下的 CPU 与分配证据；修改后同时验证响应正确、吞吐、延迟、错误和内存。若 CPU 降低却多了大缓存，应报告成本转移，而不是只选改善的图。

## 8. 练习与答案

### 8.1 分配最多的类是否就是泄漏最多的类

不是。短命对象可以高频分配后很快回收；泄漏要看不应保留的存活量及引用路径，两者需要不同证据。

### 8.2 锁事件数量为零，是否没有任何线程等待

不能。可能阈值过滤、事件未开、用的是其他等待机制或时间窗没覆盖。检查配置与线程/JFR 的其他事件。

### 8.3 火焰图右边的框是否比左边发生得晚

普通聚合火焰图不是时间线，不能这样读。需要时序应查看录制事件时间或专门的时间视图。

## 9. 继续阅读

- [线程、锁、CPU 与卡顿定位](./03-线程锁CPU与卡顿定位.md)
- [Heap、Native Memory 与 OOM 排查](./04-Heap-NativeMemory与OOM排查.md)
