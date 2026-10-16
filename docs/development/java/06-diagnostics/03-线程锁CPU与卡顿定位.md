---
title: "线程、锁、CPU 与卡顿定位"
sidebar_label: "03. 线程、锁、CPU 与卡顿定位"
sidebar_position: 3
description: "从线程身份、重复栈快照和有界锁竞争实验理解高 CPU、锁等待、死锁与线程池饥饿，避免只看 RUNNABLE 猜根因。"
tags: [Java, JVM, 线程, 锁, 排障]
---

# 线程、锁、CPU 与卡顿定位

“线程还活着”只说明它没有终止，不说明业务在前进。CPU 高与 CPU 低的卡顿需要不同入口；RUNNABLE、BLOCKED、WAITING 也不是简单的健康等级。

## 1. 先区分计算与等待

先关联请求延迟、吞吐、错误、CPU、在途请求和队列。CPU 高时寻找实际消耗 CPU 的线程及调用路径；CPU 低而排队增长时，寻找锁、连接池、任务完成条件或下游等待。还应排除 CPU 配额耗尽导致的“拿不到 CPU”。

## 2. 三种 ID 不要混在一起

传统 HotSpot 平台线程转储中：Java thread ID 是 Java 层标识；`nid` 通常是十六进制的 OS native thread ID；`tid=0x...` 常是 VM 内部线程结构标识，不是直接拿给 `top` 的 Linux TID。

Linux 上可先查看：

```bash
top -H -p 12345
ps -L -p 12345 -o pid,tid,pcpu,stat,comm
printf '%x\n' 24680
jcmd 12345 Thread.print -l
```

假设热线程 OS TID 为 24680，十六进制为 `6068`，再寻找 `nid=0x6068`。PID 和 TID 都是示例，需以当前进程核对。转换是关联平台线程的一种办法，不是跨所有操作系统的通用命令。

## 3. 重复快照怎样提供更多证据

隔一段与故障时间尺度相适应的间隔采集三次，例如几秒一次；每次保存独立文件，别用无上限的 tight loop。

```bash
jcmd 12345 Thread.print -l > threads-1.txt
jcmd 12345 Thread.print -l > threads-2.txt
jcmd 12345 Thread.print -l > threads-3.txt
```

上面只展示采集命令，需要自行在各次之间留间隔。反复出现在同一调用点，加上 CPU/等待指标才有意义：高 CPU 线程反复在同一循环更支持计算热点；等待线程反复停在连接获取则要检查谁持有连接、池是否饱和及超时。

## 4. 用受控程序看到 BLOCKED 与锁拥有者

```java title="LockEvidenceDemo.java"
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class LockEvidenceDemo {
    public static void main(String[] args) throws Exception {
        Object lock = new Object();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Thread holder = Thread.ofPlatform().name("lock-holder").start(() -> {
            synchronized (lock) {
                entered.countDown();
                try { release.await(); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            }
        });
        Thread waiter = null;
        try {
            if (!entered.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("holder timeout");
            waiter = Thread.ofPlatform().name("lock-waiter").start(() -> {
                synchronized (lock) { /* acquire after holder leaves */ }
            });
            var bean = ManagementFactory.getThreadMXBean();
            ThreadInfo info = null;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (System.nanoTime() < deadline) {
                info = bean.getThreadInfo(waiter.threadId());
                if (info != null && info.getThreadState() == Thread.State.BLOCKED) break;
                Thread.sleep(5);
            }
            if (info == null || info.getThreadState() != Thread.State.BLOCKED)
                throw new IllegalStateException("blocked state not observed");
            System.out.println("blocked=" + (info.getThreadState() == Thread.State.BLOCKED));
            System.out.println("owner=" + info.getLockOwnerName());
        } finally {
            release.countDown();
            holder.join(5000);
            if (waiter != null) waiter.join(5000);
        }
        if (holder.isAlive() || (waiter != null && waiter.isAlive()))
            throw new IllegalStateException("threads did not stop");
        System.out.println("result=done");
    }
}
```

```bash
javac --release 25 -d out LockEvidenceDemo.java
java -cp out LockEvidenceDemo
```

```text title="expected-output"
blocked=true
owner=lock-holder
result=done
```

这里 holder 在持有内置监视器时等待 latch，waiter 因进入该监视器而 BLOCKED；主线程最终释放条件，两个线程都能退出。观察有超时，清理在 finally，不需要制造不可恢复死锁。

## 5. 状态说明什么

| 状态/栈 | 可能含义 | 下一步 |
| --- | --- | --- |
| RUNNABLE | 执行中，或在某些 native/I/O 路径 | CPU 采样、native 栈、OS 调度 |
| BLOCKED | 等待进入内置 monitor | 找拥有者及其完整调用栈 |
| WAITING/TIMED_WAITING | park、条件、join、sleep 等 | 等什么条件，谁负责满足 |
| 大量 executor worker 等任务 | 也可能只是正常空闲 | 对照入口、队列和活跃数 |

`ReentrantLock`、Semaphore 等竞争常以 park 等待表现，不必是 BLOCKED。锁拥有者本身可能阻塞在远程调用，真正解决方向是缩小持锁范围或消除外部等待，而不是简单加线程。

## 6. 死锁与线程池饥饿不是一回事

监视器或可识别同步器形成循环等待时，工具可能给出 deadlock 结果；但没有检测到死锁不代表所有逻辑都能前进。

例如固定线程池里所有 worker 都在同步等待提交到同池的子任务，子任务却排在队列中。这是任务依赖与执行资源的饥饿，未必形成工具可识别的锁环。需要任务关系、池活跃数、队列和栈共同解释。

## 7. 虚拟线程要换观察方式

虚拟线程不与 OS 线程一一绑定，某个载体的 native TID 不能代表某个虚拟请求的完整生命周期。大量虚拟线程时，可按目标 help 使用：

```bash
jcmd 12345 help Thread.dump_to_file
jcmd 12345 Thread.dump_to_file -format=json threads.json
```

结合 JFR 和请求标识关联；不要以传统 `Thread.print` 中平台线程数量当成全部业务并发，也不要把 Java 旧版本关于 synchronized 固定载体的结论直接套到 JDK 25。

## 8. 练习与答案

### 8.1 看到一百个 WAITING 线程，是否应该重启

不能这样判断。可能是空闲线程池，也可能是连接/任务依赖耗尽。先明确等待对象、满足条件的执行者及业务是否仍在前进。

### 8.2 deadlock 检测没结果，为什么线程池仍完全停住

可能是任务依赖形成资源饥饿、无限外部等待或遗漏完成条件，超出锁环检测覆盖范围。补任务图、队列和超时证据。

### 8.3 为什么一次线程栈不足以量化方法耗时

它只是一瞬间的位置，没有完整频次和持续时间。重复快照提供趋势，采样或事件提供分布，再与业务时间对齐。

## 9. 继续阅读

- [JDK 诊断工具官方指南](https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html)
- [线程池、队列、拒绝与关闭](../03-concurrency/06-线程池队列拒绝与关闭.md)
- [Heap、Native Memory 与 OOM 排查](./04-Heap-NativeMemory与OOM排查.md)
