---
title: "Lock、Condition、AQS 与同步器的职责"
sidebar_label: "04. Lock、Condition、AQS 与同步器"
sidebar_position: 4
description: "解释可中断和限时加锁、条件队列、AQS 状态与等待、Semaphore/Latch/Barrier 选择，以及公平性和复合资源边界。"
tags: [Java, Lock, Condition, AQS, Semaphore]
---

# Lock、Condition、AQS 与同步器的职责

synchronized 适合清楚的块级互斥；需要可中断获取、限时尝试或分离多个等待条件时，可以使用显式锁。Lock、Condition、Semaphore 和 CountDownLatch 不是不同名字的同一把锁，它们分别表达资源所有权、条件、许可和阶段完成。

本篇使用 JDK 25，先明确协调语义，再理解实现骨架 AQS。

## 1. 显式锁增加了哪些能力

ReentrantLock.lock 获取锁；lockInterruptibly 允许等待期间响应中断；tryLock 可以立即或限时尝试。只有成功获取后才能在 finally 中 unlock，不能把未成功获取也放进统一释放分支。

```java
// 片段：获取失败不会执行 unlock。
lock.lockInterruptibly();
try {
    updateState();
} finally {
    lock.unlock();
}
```

显式锁不由代码块语法自动释放，因此遗漏 finally 会造成严重问题。公平锁可以改善部分获取顺序，但不保证线程调度绝对公平；无参 tryLock 还有其特定的插队行为，不能看到 fair=true 就推断所有 API 严格 FIFO。[ReentrantLock API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)说明了差异。

## 2. Condition 与锁关联

一个 Lock 可以创建多个 Condition，例如队列的 notEmpty 与 notFull。await 在持有所属锁时原子地进入条件等待并释放锁，返回前重新获取锁；signal 不是直接转移所有权。

等待仍然必须使用 while 检查状态，处理虚假唤醒和其他线程先改变条件。Condition 不能脱离所属锁任意使用，也不能把 signal 当成可累计的许可。

## 3. 条件与许可实验

```java title="LockDemo.java"
import java.time.Duration;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

public class LockDemo {
    static final class Gate {
        private final ReentrantLock lock = new ReentrantLock();
        private final Condition opened = lock.newCondition();
        private boolean open;

        void awaitOpen() throws InterruptedException {
            lock.lockInterruptibly();
            try {
                while (!open) opened.await();
            } finally {
                lock.unlock();
            }
        }

        void open() {
            lock.lock();
            try {
                open = true;
                opened.signalAll();
            } finally {
                lock.unlock();
            }
        }
    }

    public static void main(String[] args) throws Exception {
        var gate = new Gate();
        var passed = new AtomicBoolean();
        Thread waiter = Thread.ofPlatform().start(() -> {
            try {
                gate.awaitOpen();
                passed.set(true);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        });
        try {
            gate.open();
            if (!waiter.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("gate timed out");
            }
        } finally {
            waiter.interrupt();
            if (!waiter.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("waiter did not stop");
            }
        }
        System.out.println("passed=" + passed.get());
        var permits = new Semaphore(2);
        boolean acquired = permits.tryAcquire(2);
        if (!acquired) throw new IllegalStateException("expected two permits");
        try {
            System.out.println("third=" + permits.tryAcquire());
        } finally {
            permits.release(2);
        }
        System.out.println("available=" + permits.availablePermits());
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out LockDemo.java
java -cp out LockDemo
```

```text title="expected-output"
passed=true
third=false
available=2
```

Gate 先打开或等待者先进入都成立，因为 open 才是事实来源。Semaphore 则可以累积许可，不要求获取和释放必须由同一线程，但业务仍必须保证不漏释放、不重复释放。

## 4. AQS 是什么

AQS（抽象队列同步器，AbstractQueuedSynchronizer）为同步器提供状态管理、等待排队、阻塞唤醒与取消等骨架，具体子类定义何时获取或释放成功。

```text
尝试更新同步状态
→ 成功：继续执行
→ 失败：根据策略进入等待队列、挂起
→ 状态变化后被唤醒
→ 再次竞争，不是唤醒即获得资源
```

ReentrantLock 用状态表达重入持有；Semaphore 用状态表达许可；CountDownLatch 用状态表达剩余完成次数。它们复用实现机制，却不共享相同使用语义。Condition 等待集合与获取锁的等待队列也有不同职责。[AQS API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html)是实现扩展契约，不要求普通业务自己重写同步器。

## 5. 同步器如何选

| 需求 | 工具 | 关键边界 |
| --- | --- | --- |
| 保护复合状态 | synchronized 或 Lock | 所有访问遵循同一协议 |
| 等待多个任务完成一个阶段 | CountDownLatch | 一次性归零，不能重置 |
| 一组线程反复会合 | CyclicBarrier / Phaser | 失败、超时与参与者退出需处理 |
| 限制同时访问下游数量 | Semaphore | 不自动限制外部排队数量 |
| 读多写少的共享结构 | 评估读写锁 | 读锁不允许随意写，升级可能死锁 |

许可限制并发，不限制每秒请求数；并发两个请求如果都很快，一秒仍可完成很多。限流器与并发隔离需要分别设计。

锁性能还受临界区长度、竞争比例与调度影响。公平策略、读写锁或 StampedLock 都不是通用加速开关；乐观读还需要正确验证并处理重试。

## 6. 练习与答案

### 6.1 tryAcquire 失败后仍然 release 会怎样

Semaphore 可能被错误增加许可，之后并发量超过设计上限。释放必须对应成功获取的数量，不能把“调用过 acquire”当成已经成功。

### 6.2 Condition.await 会释放其他 Lock 吗

不会，只释放它关联的锁。持有其他资源等待时仍可能阻止条件被满足，需要审查整体锁顺序。

### 6.3 公平锁是否保证每个请求按到达顺序返回

不保证。线程调度、不同 API 路径和业务执行时间都会影响完成顺序。锁的获取政策不是完整请求调度器。

## 7. 继续阅读

- [Condition API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Condition.html)
- [Semaphore API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html)
- [CAS、原子类与并发容器](./05-CAS原子类与并发容器.md)
