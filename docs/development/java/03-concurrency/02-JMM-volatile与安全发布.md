---
title: "JMM、volatile、happens-before 与安全发布"
sidebar_label: "02. JMM、volatile 与安全发布"
sidebar_position: 2
description: "从消息发布解释原子性、可见性、有序性和数据竞争，建立 happens-before 推理，辨别 volatile、final 与对象不可变的边界。"
tags: [Java, JMM, volatile, happens-before]
---

# JMM、volatile、happens-before 与安全发布

一个线程已经给字段赋值，另一个线程却不能仅凭“过了一会儿”就保证看见。Java 内存模型 JMM 规定线程间允许观察到哪些结果；CPU 缓存、编译优化和执行重排必须遵守这些语言规则。

本篇使用 JDK 25。JMM 不是 JVM 堆、栈分区图，也不能简单等同于“把缓存刷新到主内存”。

## 1. 三类问题分别是什么

原子性回答操作是否能被观察为不可拆分；可见性回答跨线程何时能看到变化；有序性回答某些操作的先后关系是否对观察者成立。

例如 count++ 包含读取、加一、写回。两个线程都读到 0，再各自写 1，最终得到 1。把 count 改成 volatile，只提供相应读写语义，不把整个读改写过程变成原子操作。

| 线程 A | 线程 B |
| --- | --- |
| 读取 count=0 | 读取 count=0 |
| 计算 1 | 计算 1 |
| 写回 1 | 写回 1 |

## 2. happens-before 怎样建立关系

它表达可见性与顺序约束，不等于墙上时钟先发生。常用关系包括同线程程序顺序、同一监视器的解锁到后续加锁、同一 volatile 变量的写到后续读，以及 start、终止观察等关系；它们还可传递。

```text
生产者：data=42 → volatile ready=true
                              ↓ volatile 同步关系
消费者：读取 ready 为 true → 读取 data
```

由这条链可以推导消费者读到发布前的数据。若 ready 不是 volatile，也没有其他同步，就不能把同样推理照搬过去。[JLS 内存模型](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4)是语义依据，不是多跑几次观察结果后猜出来的规则。

## 3. 发布实验

```java title="PublicationDemo.java"
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

public class PublicationDemo {
    static final class Message {
        int data;
        volatile boolean ready;
    }

    public static void main(String[] args) throws Exception {
        var message = new Message();
        var result = new AtomicInteger(-1);
        Thread reader = Thread.ofPlatform().unstarted(() -> {
            while (!message.ready) {
                if (Thread.currentThread().isInterrupted()) return;
                Thread.onSpinWait();
            }
            result.set(message.data);
        });
        Thread writer = Thread.ofPlatform().unstarted(() -> {
            message.data = 42;
            message.ready = true;
        });
        reader.start();
        writer.start();
        try {
            if (!writer.join(Duration.ofSeconds(5)) || !reader.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("publication timed out");
            }
        } finally {
            reader.interrupt();
            writer.interrupt();
            if (!reader.join(Duration.ofSeconds(5)) || !writer.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("threads did not stop");
            }
        }
        System.out.println("published=" + result.get());
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out PublicationDemo.java
java -cp out PublicationDemo
```

```text title="expected-output"
published=42
```

示例用短暂自旋突出发布关系，不建议业务请求长期忙等。等待条件可使用锁、队列或 Future，既提供同步关系，也能挂起等待。Thread.onSpinWait 是运行时提示，不会单独建立可见性。

## 4. volatile 适合什么，不适合什么

单个停止标志、不可变配置快照的引用替换，是常见用法。发布引用前完整构造对象；读者读取一次引用，基于同一快照完成判断，可以避免多次读取拼出不同版本。

volatile 引用不会让其对象内部所有后续修改自动安全。多个字段需要维持“总额与明细一致”等复合不变量时，应把它们装入一个不可变快照一起替换，或用同一锁保护整个操作。

双重检查初始化依赖正确 volatile 发布和构造过程。普通业务可优先用类初始化、显式装配或成熟容器，不应为了减少一次加锁随意编写未发布安全的懒加载。

## 5. final 与安全构造

final 字段有专门的初始化安全规则，正确构造且不让 this 在构造期间逃逸非常重要。但 final 引用不冻结对象，final List 仍能被 add，构造之后的可变状态仍需同步。[JLS final 语义](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5)不能简化为“所有 final 对象都线程安全”。

安全发布还可借助类初始化、同步、并发容器和任务提交等约定。选择机制时说明读者通过哪条同步边拿到对象，而不是只说“对象已存在堆里”。

## 6. 如何验证并发假设

普通单元测试通过只能证明当次观察，没有证明所有交错。分析先找共享变量、读写位置和同步边，再用受控交错测试或专门的并发测试工具增加覆盖。

日志、断点和 sleep 都可能改变调度，甚至额外引入同步。不能因为加日志后问题消失，就把日志当作修复；应修复缺失的同步关系。

## 7. 练习与答案

### 7.1 把 ready 改成普通 boolean，实验仍成功就安全吗

不安全。数据竞争程序可能在某些环境恰好表现正常，也可能循环不退出或观察到不符合预期的数据。安全性来自语言规则和同步协议，不来自成功次数。

### 7.2 两个 volatile 字段是否一起形成原子快照

不会。读者可能在两次写之间读取到混合状态。把状态合成不可变对象经一个引用发布，或者使用同一锁。

### 7.3 锁只保护写操作，读操作不加锁可以吗

通常不够。读写必须遵守同一套发布与同步协议；只给写者加锁，不为普通读者建立所需关系。

## 8. 继续阅读

- [synchronized、Monitor 与条件等待](./03-synchronized-Monitor与条件等待.md)
- [并发包内存一致性约定](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html)
