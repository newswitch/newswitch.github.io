---
title: "Thread 生命周期、中断与协作退出"
sidebar_label: "01. Thread 生命周期、中断与退出"
sidebar_position: 1
description: "区分任务和线程、start 与 run、Java 线程状态、中断标志、join 可见性、守护线程与失败传播，建立可控退出的线程实验。"
tags: [Java, Thread, 中断, 线程生命周期]
---

# Thread 生命周期、中断与协作退出

一个方法调用通常沿当前线程执行；把任务交给新线程后，执行顺序、错误接收者和退出责任都需要重新定义。并发的第一步不是创建尽可能多的线程，而是知道每个线程由谁启动、何时完成、失败后谁能发现。

本篇使用 JDK 25 的平台线程。后面的虚拟线程仍遵守中断与生命周期的基本约定。

## 1. 任务不等于线程

Runnable 描述没有返回值的任务，Thread 提供执行该任务的线程身份。调用 run 只是普通方法调用，仍在当前线程；start 才把线程安排到独立执行路径。同一 Thread 只能启动一次，结束后不能再次 start。

```text
创建 Thread → NEW → start → 执行 run → 正常返回或未捕获异常 → TERMINATED
                           ↕ 等待锁、等待条件、定时等待
```

新线程与创建者共享进程中的对象和外部资源，但拥有自己的调用栈。把对象交给另一线程，并不会自动复制对象或让其方法线程安全。

## 2. Java 线程状态如何理解

| 状态 | 含义 | 不能据此断言 |
| --- | --- | --- |
| NEW | 尚未启动 | 任务已在后台运行 |
| RUNNABLE | 可运行或正在运行的 Java 状态 | 一定正在占用 CPU，也可能涉及底层 I/O 等待 |
| BLOCKED | 等待进入 synchronized 监视器 | 所有阻塞操作都会显示为它 |
| WAITING | 无时限等待，如部分 wait/join/park | 一定死锁 |
| TIMED_WAITING | 有时限等待 | 到时后立刻获得 CPU |
| TERMINATED | 执行结束 | 业务一定成功 |

getState 是观察瞬间，不是线程间协调协议。需要确认某个阶段已经到达，用 CountDownLatch 等明确同步工具；不要反复轮询线程状态猜测。

## 3. 中断是请求，不是强杀

interrupt 通常设置目标线程的中断状态；sleep、wait、join 等可中断等待会抛 InterruptedException，并清除状态。捕获者应选择向上传播，或者恢复标志后退出当前工作。

`isInterrupted()` 读取状态而不清除；静态 `Thread.interrupted()` 读取并清除当前线程的状态。它不是查询任意目标线程的方法。

运行纯计算的线程需要主动检查取消条件；某些 I/O 的中断行为由具体 API 决定。中断不保证远端操作回滚，也不保证立即停止。不要使用废弃的强制停止机制破坏对象不变量。[Thread API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)规定了各操作行为。

## 4. 可重复的退出实验

```java title="ThreadDemo.java"
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class ThreadDemo {
    public static void main(String[] args) throws Exception {
        var entered = new CountDownLatch(1);
        var blocker = new CountDownLatch(1);
        var restored = new AtomicBoolean();
        Thread worker = Thread.ofPlatform().name("task-worker").unstarted(() -> {
            entered.countDown();
            try {
                blocker.await();
            } catch (InterruptedException expected) {
                Thread.currentThread().interrupt();
                restored.set(Thread.currentThread().isInterrupted());
            }
        });
        System.out.println("before=" + worker.getState());
        worker.start();
        try {
            if (!entered.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("worker did not enter");
            }
            worker.interrupt();
        } finally {
            worker.interrupt();
            if (!worker.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("worker did not terminate");
            }
        }
        System.out.println("after=" + worker.getState());
        System.out.println("restored=" + restored.get());
        System.out.println("mainInterrupted=" + Thread.currentThread().isInterrupted());
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out ThreadDemo.java
java -cp out ThreadDemo
```

```text title="expected-output"
before=NEW
after=TERMINATED
restored=true
mainInterrupted=false
```

CountDownLatch 明确建立阶段关系，不依赖 sleep 恰好等够。中断即使发生在 await 前，await 也会检查已有状态。join 等待执行结束，不会把工作线程的中断状态转移给 main。

## 5. 完成、可见性与失败传播

成功观察到线程结束的 join，为调用者观察该线程此前的操作建立相应 happens-before 关系；它不是让任意运行中的数据竞争变安全。[JLS 线程规则](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4.5)解释了 start 与终止观察的关系。

工作线程的未捕获异常不会自动从 main 的 start 调用处抛出。可使用 UncaughtExceptionHandler 记录线程级失败，或者使用 Future 把任务结果和失败交给提交者。仅看到线程结束不能认定任务完成了业务目标。

非守护平台线程可以延长 JVM 生命周期；守护线程不能保证 JVM 退出前执行完 finally 或写完数据。重要任务应显式等待和关闭，不能通过改成 daemon 掩盖泄漏。

## 6. 练习与答案

### 6.1 为什么不能用 sleep 100 毫秒代替 entered

时间流逝不证明另一线程获得过 CPU，更不建立所需的数据可见性。机器负载变化会让这种测试不稳定，应使用明确同步事件。

### 6.2 catch InterruptedException 后继续无限循环有什么问题

异常清除了中断标志，继续等待可能吞掉退出请求。应按照任务契约向上传播或恢复状态并退出，只有明确承担取消处理责任时才能消费中断。

### 6.3 join 超时返回后能直接读取任务结果吗

不能假设任务已完成。先确认成功观察到终止，再读取完成结果；超时还需要取消、清理或向上报告，不能伪装成成功。

## 7. 继续阅读

- [JMM、volatile 与安全发布](./02-JMM-volatile与安全发布.md)
- [CountDownLatch API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html)
