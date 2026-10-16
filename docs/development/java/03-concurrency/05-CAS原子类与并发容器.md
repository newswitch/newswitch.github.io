---
title: "CAS、原子类、LongAdder 与并发容器"
sidebar_label: "05. CAS、原子类与并发容器"
sidebar_position: 5
description: "解释比较交换、重试与 ABA，区分 AtomicInteger、LongAdder、ConcurrentHashMap 和普通可变值，明确单点原子与复合一致性。"
tags: [Java, CAS, AtomicInteger, LongAdder, ConcurrentHashMap]
---

# CAS、原子类、LongAdder 与并发容器

给计数器加锁可以正确工作；在合适场景中，原子类可以用单变量原子更新表达同样目标。并发容器进一步协调内部结构，但它们都不会自动把整个业务流程变成事务。

本篇使用 JDK 25，分别观察精确计数、统计累加与按键聚合。

## 1. CAS 比较的是什么

CAS 是 Compare And Set：比较当前位置是否仍等于预期值，若相等则原子替换，否则返回失败。多个线程竞争时，失败者可以重新读取并重试，也可以放弃。

```text
读取旧值 → 计算新值 → CAS(旧值, 新值)
                         ├── 成功：更新完成
                         └── 失败：状态已不符合预期，重新决策
```

AtomicInteger.incrementAndGet 将增量作为原子更新；volatile int 的 count++ 没有这种保证。不同原子 API 有不同内存访问模式，不能把名字包含 Atomic 的所有方法一律理解为同一种强度。[原子包文档](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/package-summary.html)给出相关语义。

## 2. 精确值与统计值

AtomicInteger/AtomicLong 适合需要单个原子数值的更新和判断。LongAdder 在竞争下分散累加，适合频繁更新的统计；并发进行时 sum 不是跨所有分片的原子快照，不应直接作为精确额度判断。

先 get 再决定 increment 仍可能竞争。限制任务额度时，需要一次 CAS 循环或一把锁覆盖“检查与扣减”，不能把两个单独原子调用当一个操作。

## 3. 并发计数实验

```java title="AtomicDemo.java"
import java.time.Duration;
import java.util.ArrayList;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.LongAdder;

public class AtomicDemo {
    public static void main(String[] args) throws Exception {
        var exact = new AtomicInteger();
        var statistics = new LongAdder();
        var counts = new ConcurrentHashMap<String, Integer>();
        var workers = new ArrayList<Thread>();
        try {
            for (int i = 0; i < 4; i++) {
                workers.add(Thread.ofPlatform().start(() -> {
                    for (int j = 0; j < 1000; j++) {
                        exact.incrementAndGet();
                        statistics.increment();
                        counts.merge("jobs", 1, Integer::sum);
                    }
                }));
            }
            for (Thread worker : workers) {
                if (!worker.join(Duration.ofSeconds(5))) {
                    throw new IllegalStateException("counter timed out");
                }
            }
        } finally {
            for (Thread worker : workers) worker.interrupt();
            for (Thread worker : workers) {
                if (!worker.join(Duration.ofSeconds(5))) {
                    throw new IllegalStateException("worker did not stop");
                }
            }
        }
        System.out.println("exact=" + exact.get());
        System.out.println("statistics=" + statistics.sum());
        System.out.println("mapped=" + counts.get("jobs"));
        System.out.println("staleCas=" + exact.compareAndSet(0, 1));
        System.out.println("currentCas=" + exact.compareAndSet(4000, 4001));
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out AtomicDemo.java
java -cp out AtomicDemo
```

```text title="expected-output"
exact=4000
statistics=4000
mapped=4000
staleCas=false
currentCas=true
```

sum 在所有工作线程结束后读取，因此这里得到完整统计。这个结果不能证明并发更新过程中每次 sum 都是精确快照。三个计数各自正确，但更新它们的三行不是跨结构的原子事务。

## 4. 重试、副作用与 ABA

某些 updateAndGet/accumulateAndGet 实现路径可能重复调用传入函数，因此回调应无外部副作用，不能在里面扣款、发消息或只生成一次的业务编号。

CAS 比较当前值，不记录它经历过什么。一个引用 A 被换成 B 后又换回 A，普通引用比较可能看不出过程，称为 ABA。需要区分变化历史时，可使用版本、AtomicStampedReference 或更适合的锁协议；版本本身也要考虑更新与回绕规则。

“无锁”不等于没有竞争或所有线程都能在固定时间完成。高冲突下重试消耗 CPU，某个线程可能长期失败；锁可能反而更容易表达并保护复杂不变量。

## 5. ConcurrentHashMap 的保证到哪里

get/put 和相应 compute/merge 操作遵循并发契约，但 `containsKey` 后再 put 不是一个原子判断，应选择 putIfAbsent 或合适 compute 方法。回调要短小，不应在持有内部协调资源期间执行慢 I/O 或递归修改同一映射。

Map 的线程安全不传递给值对象。`map.computeIfAbsent(key, k -> new ArrayList<>()).add(value)` 并不会让该 ArrayList 的 add 线程安全。可以使用不可变值替换、合适并发集合或额外同步。[ConcurrentHashMap API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html)也区分单键更新与整体观察。

迭代通常是弱一致的，不是锁住整张表的快照。size 等聚合观察在并发修改时不应作为精确控制依据。它不允许 null 键和值，避免把 null 与缺失混淆。

## 6. 练习与答案

### 6.1 两个 AtomicLong 分别保存余额和冻结额，转账就原子了吗

没有。它们各自原子，不保证两者同时变化。需要将相关状态作为一个不可变整体 CAS 替换，或用锁/事务覆盖完整约束。

### 6.2 LongAdder 能用来实现还剩最后一个名额的抢占吗

不适合作为独立精确判定。sum 与后续增加不是一个原子动作，应使用 CAS 限额、Semaphore 或完整同步协议。

### 6.3 并发容器不抛 ConcurrentModificationException，就没有竞争吗

不是。它可能提供弱一致遍历，允许并发变化；是否满足业务一致性仍需判断，不能用某个异常是否出现证明正确性。

## 7. 继续阅读

- [LongAdder API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html)
- [线程池、队列与拒绝策略](./06-线程池队列拒绝与关闭.md)
