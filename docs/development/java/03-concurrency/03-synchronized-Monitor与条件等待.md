---
title: "synchronized、Monitor 与条件等待"
sidebar_label: "03. synchronized、Monitor 与条件等待"
sidebar_position: 3
description: "解释监视器互斥与可见性、锁对象身份、可重入、wait/notifyAll、条件循环、锁顺序与线程转储中的阻塞。"
tags: [Java, synchronized, Monitor, wait, notifyAll]
---

# synchronized、Monitor 与条件等待

多个线程修改同一任务状态，需要保护“检查条件到修改状态”的完整过程。synchronized 同时提供互斥与相应内存可见性；wait/notifyAll 进一步允许线程等待状态变化，而不是持锁忙等。

本篇使用 JDK 25，通过单槽消息盒理解监视器协议。

## 1. 锁的身份必须相同

实例 synchronized 方法锁当前 this；static synchronized 方法锁对应的 Class 对象；代码块锁显式表达式指向的对象。两段代码都写 synchronized，但锁不同对象，就不能彼此排斥。

推荐用 private final 的独立锁对象，避免外部代码参与同一锁协议。不要把可能共享的字符串常量、装箱数值或随时更换的字段当锁。

锁可重入：同一线程可以再次获取已经持有的监视器，退出相应层数后才完全释放。退出 synchronized 块时，无论正常返回还是异常传播，监视器都会按语义释放；业务状态是否保持合法仍由代码负责。

## 2. 等待条件与等待锁不同

```text
进入 synchronized
→ 检查共享条件
→ 不满足：wait 原子地进入等待并释放该监视器
→ 被通知、超时或中断后重新竞争该监视器
→ 重新检查条件
→ 满足后修改状态、通知，再退出
```

wait 只能在持有相应对象监视器时调用，且只释放那个监视器，不释放线程持有的所有锁。sleep 不会释放已持有的监视器。

notify/notifyAll 不会立即把锁交给等待者；通知线程退出同步区后，等待者仍需竞争。通知不是可以累积的消息，真正应保存的是条件状态。[Object API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html)规定了监视器等待行为。

## 3. 单槽消息盒实验

```java title="MonitorDemo.java"
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

public class MonitorDemo {
    static final class Slot {
        private Integer value;

        synchronized void put(int next) throws InterruptedException {
            while (value != null) wait();
            value = next;
            notifyAll();
        }

        synchronized int take() throws InterruptedException {
            while (value == null) wait();
            int result = value;
            value = null;
            notifyAll();
            return result;
        }
    }

    public static void main(String[] args) throws Exception {
        var slot = new Slot();
        var received = new AtomicInteger(-1);
        Thread consumer = Thread.ofPlatform().unstarted(() -> {
            try {
                received.set(slot.take());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        });
        consumer.start();
        try {
            slot.put(42);
            if (!consumer.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("consumer did not finish");
            }
        } finally {
            consumer.interrupt();
            if (!consumer.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("consumer did not stop");
            }
        }
        System.out.println("received=" + received.get());
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out MonitorDemo.java
java -cp out MonitorDemo
```

```text title="expected-output"
received=42
```

先 put 或先 take 都正确：状态记录在 value 中，消费者不会因为“通知先到”而错过已存在的数据。示例只传一条消息；生产队列还需要容量、关闭、超时和取消协议，通常应直接选择合适 BlockingQueue。

## 4. 为什么一定用 while

等待可能发生虚假唤醒；多个消费者也可能被一起唤醒，但只有一个拿到消息。醒来并获得锁时，条件可能已经再次不满足。因此必须在循环中重查，不能把 if 改成等待一次后无条件继续。

notifyAll 避免在多种条件共用一个等待集合时只唤醒了不适合继续的线程，但也会增加竞争。多个独立条件可以用 ReentrantLock 的多个 Condition 分开管理，仍必须遵守条件循环。

## 5. 锁粒度与死锁

锁应覆盖完整不变量，但不应无必要地包含网络调用、慢文件 I/O 或用户回调。持锁等待远端会让其他线程连本地状态都不能访问，形成队头阻塞。

两个线程按相反顺序持有多把锁，可能形成循环等待。统一锁顺序、缩小嵌套范围，必要时使用有超时获取与回退协议。把锁换成 ReentrantLock 不会自动消除死锁。

线程转储中 BLOCKED 可提示监视器竞争；wait 常见于 WAITING/TIMED_WAITING。需要结合持锁者、等待对象和多次采样判断，单张转储不能说明锁竞争已经持续多久。

## 6. 版本与实现边界

synchronized 的语言契约是互斥、可重入与内存同步。旧资料中的锁实现布局、偏向锁和锁升级细节，不应作为 JDK 25 的通用运行承诺。虚拟线程的监视器固定问题也随 JDK 版本改变，后续专题按 JDK 25 说明。

## 7. 练习与答案

### 7.1 synchronized 方法互相调用一定死锁吗

同一线程获取同一个监视器允许重入，不会仅因再次获取就死锁。多把锁与不同线程形成循环等待才是另一类风险。

### 7.2 在 value 赋值之前通知，是否永远错误

通知与赋值若处于同一正确同步区，等待者仍要重新获取锁，不能仅按这两行的位置判断。但“修改状态后再通知”更清楚；脱离同一锁协议则可能丢失协调或直接失败。

### 7.3 wait 之后还持有另一个锁，会有什么问题

wait 只释放调用对象的监视器，另一把锁仍可能阻碍生产者更新条件，进而死锁。等待协议要审查所有持有的资源，不只看当前对象。

## 8. 继续阅读

- [Lock、Condition、AQS 与同步器](./04-Lock-Condition-AQS与同步器.md)
- [JLS 锁与同步](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.1)
