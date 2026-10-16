---
title: "Queue、Deque 与 PriorityQueue 的顺序和容量"
sidebar_label: "06. Queue、Deque 与 PriorityQueue"
sidebar_position: 6
description: "区分 FIFO、LIFO 和优先级堆，解释双端 API、空队列语义、稳定排序、无界积压与背压。"
tags: [Java, Queue, Deque, PriorityQueue, 背压]
---

# Queue、Deque 与 PriorityQueue 的顺序和容量

队列表示等待处理的工作，但接口名字并不能保证先来先服务。ArrayDeque 可以表达 FIFO 或栈；PriorityQueue 先取比较器判定最小的元素。任何一种顺序都不自动限制积压量。

本篇使用 JDK 25，先在单线程中确认顺序，再为后续并发队列建立边界。

## 1. 空与满有两组 API

| 操作 | 失败时抛异常 | 使用特殊返回值 |
| --- | --- | --- |
| 入队 | add | offer 返回 false，适用于可拒绝的有界实现 |
| 出队 | remove | poll 返回 null |
| 查看队首 | element | peek 返回 null |

ArrayDeque、PriorityQueue 不允许 null，避免与空队列返回值混淆。它们会按需增长，不会因为构造器写了 100，就变成容量上限 100。

Deque 的 addLast/pollFirst 是 FIFO；push/pop 在同一端操作，是 LIFO。明确写端点比混用一堆别名更便于维护。[ArrayDeque API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html)描述了两端行为。

## 2. 优先队列不是完整排序数组

PriorityQueue 通常以堆维护“当前最小元素在顶部”，入队和出队为对数级，peek 为常数级，查找任意元素仍可能是线性。迭代器不保证按优先级输出，需要连续 poll 或复制后排序。

同优先级元素没有自动 FIFO 保证。业务要求稳定时，增加单调序号作为第二比较条件。修改已入队对象的优先级，也不会自动重建堆，应移除后重新加入。

## 3. 顺序实验

```java title="QueueDemo.java"
import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.PriorityQueue;

public class QueueDemo {
    record Job(String name, int priority, long sequence) {}

    public static void main(String[] args) {
        var fifo = new ArrayDeque<String>();
        fifo.addLast("a");
        fifo.addLast("b");
        System.out.println("fifo=" + fifo.pollFirst() + "," + fifo.pollFirst());
        System.out.println("empty=" + fifo.pollFirst());
        fifo.push("a");
        fifo.push("b");
        System.out.println("stack=" + fifo.pop() + "," + fifo.pop());

        var jobs = new PriorityQueue<Job>(Comparator.comparingInt(Job::priority)
                .thenComparingLong(Job::sequence));
        jobs.offer(new Job("normal", 5, 1));
        jobs.offer(new Job("urgent-first", 1, 2));
        jobs.offer(new Job("urgent-second", 1, 3));
        while (!jobs.isEmpty()) {
            System.out.println("next=" + jobs.poll().name());
        }
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out QueueDemo.java
java -cp out QueueDemo
```

```text title="expected-output"
fifo=a,b
empty=null
stack=b,a
next=urgent-first
next=urgent-second
next=normal
```

priority 数值越小越优先是本例定义，不是 PriorityQueue 内置业务含义。sequence 是第二排序条件，不能把记录的创建时间毫秒当作绝对唯一序号。

## 4. 无界队列为什么危险

如果每秒入队 120 个任务，只处理 100 个，每分钟净积压约 1200 个。单个任务对象还可能引用请求正文和上下文，内存成本远大于一个队列槽位。

容量限制要覆盖排队任务数、总字节数和等待时间。满时可以拒绝、限流、阻塞生产者或转交外部消息系统，但必须在接口上表达清楚。无界 PriorityQueue 不会帮忙解决背压，优先级还可能导致低优先级任务长期饥饿。

ArrayDeque 和 PriorityQueue 都不是普通并发安全容器。多个线程使用时，`isEmpty` 后 `poll` 也不是一个原子操作。后续学习 BlockingQueue 时再分析等待、唤醒、取消和关闭。

## 5. 堆与树的选择

只需要不断取最优先任务，使用堆即可；需要范围查询、前后邻居和按键定位，可以考虑有序 Map。需要按 id 取消堆中任务时，普通 PriorityQueue.remove 是线性成本，规模大时可能需要额外索引或不同结构。

## 6. 练习与答案

### 6.1 new PriorityQueue(100) 能阻止第 101 个任务吗

不能。100 是初始容量参数，不是最大任务数。需要明确有界实现或外层容量控制，并保证并发下控制与入队的一致性。

### 6.2 为什么打印队列看起来没有排序

迭代顺序不是优先级顺序。堆只保证堆顶满足优先关系，不保证底层数组整体有序。复制队列后逐个 poll 可在不消耗原队列的前提下观察处理顺序。

### 6.3 任务优先级改变，队列会立即调整吗

不会。容器不会监听对象字段。使用不可变任务记录；重新排队时还要处理取消与并发处理之间的竞态。

## 7. 继续阅读

- [PriorityQueue API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html)
- [迭代器、集合视图与工具类](./07-迭代器集合视图与工具类.md)
