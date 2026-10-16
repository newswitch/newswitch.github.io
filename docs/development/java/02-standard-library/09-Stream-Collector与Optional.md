---
title: "Stream、Collector 与 Optional 的执行语义"
sidebar_label: "09. Stream、Collector 与 Optional"
sidebar_position: 9
description: "解释流的惰性、终止与短路、分组归约、顺序与副作用、并行开销，以及 Optional 的缺失语义和延迟回退。"
tags: [Java, Stream, Collector, Optional]
---

# Stream、Collector 与 Optional 的执行语义

Stream 描述数据如何经过筛选、转换和归约，不是保存数据的新集合。Optional 描述结果可能缺失，不是通用的 null 包装器。理解它们的执行时机，才能避免重复消费、隐藏副作用和昂贵回退。

本篇使用 JDK 25，以任务优先级统计为例。

## 1. 从数据源到终止操作

```text
List 数据源 → filter 中间操作 → map 中间操作 → collect 终止操作
                          管道在终止时按需执行
```

中间操作通常惰性，终止操作启动求值。findFirst、anyMatch 等可以短路，不一定访问全部元素。sorted 等有状态操作可能需要缓存大量数据，并非所有管道都只用常数内存。

流消费后不能再使用；需要第二次计算应从数据源创建新流。I/O 来源的 Files.lines 等还持有资源，必须关闭，不能因为“是 Stream”就忘记所有权。语义见 [Stream 包文档](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html)。

## 2. 分组、计数和延迟回退实验

```java title="StreamDemo.java"
import java.util.List;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

public class StreamDemo {
    record Task(String owner, int priority) {}

    public static void main(String[] args) {
        var tasks = List.of(new Task("alice", 1), new Task("bob", 5), new Task("alice", 2));
        var visited = new AtomicInteger();
        var pipeline = tasks.stream().filter(task -> {
            visited.incrementAndGet();
            return task.priority() <= 2;
        });
        System.out.println("before=" + visited.get());
        List<Task> urgent = pipeline.toList();
        System.out.println("visited=" + visited.get());
        var counts = urgent.stream().collect(Collectors.groupingBy(
                Task::owner, TreeMap::new, Collectors.counting()));
        System.out.println("counts=" + counts);
        int total = tasks.stream().mapToInt(Task::priority).sum();
        System.out.println("priorityTotal=" + total);

        var fallbackCalls = new AtomicInteger();
        String owner = Optional.of("alice").orElseGet(() -> {
            fallbackCalls.incrementAndGet();
            return "unknown";
        });
        System.out.println("owner=" + owner);
        System.out.println("fallbackCalls=" + fallbackCalls.get());
        System.out.println("missing=" + Optional.<String>empty().map(String::length).orElse(0));
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out StreamDemo.java
java -cp out StreamDemo
```

```text title="expected-output"
before=0
visited=3
counts={alice=2}
priorityTotal=8
owner=alice
fallbackCalls=0
missing=0
```

filter 中的计数仅为展示本例执行时机。生产计算不应依赖中间操作的副作用；某些管道优化可省略不影响结果的阶段，例如已知大小时 count 可能不执行 peek。

## 3. 归约与收集不是随意写循环

reduce 的组合规则需要满足结合性和正确单位元，尤其在并行分段归并时。减法不满足结合律，浮点加法也存在舍入差异，因此切换 parallel 后不一定逐位复现顺序结果。

collect 用于可变容器归约。使用合适的 supplier、accumulator、combiner，不能让多个分段错误共享同一 ArrayList。toMap 遇到重复键需要明确合并规则；不要让“后来的覆盖”成为未声明的偶然行为。

Stream.toList 返回不可修改列表；Collectors.toList 不承诺具体实现或可修改性。确需可变 ArrayList 时使用 `Collectors.toCollection(ArrayList::new)`。

## 4. 顺序与并行成本

有序源有 encounter order，但 forEach 在并行流中不保证按该顺序执行；forEachOrdered 可以维持观察顺序，却可能限制并行收益。

parallelStream 不是免费加速：拆分、调度、合并、内存带宽和共享池竞争都可能超过计算收益。阻塞 I/O 不宜直接扔进默认并行流当作无限并发请求器。应明确线程池、并发上限和超时，再按负载测量。

函数应尽量无状态且不干扰数据源。Stream 并不自动为捕获变量、外部集合或数据库事务提供线程安全。

## 5. Optional 的缺失语义

of 拒绝 null，ofNullable 把 null 变成空。map 转换存在值，flatMap 连接返回 Optional 的操作，避免 Optional 套 Optional。

`orElse(expensive())` 会先计算实参，即使原值存在；orElseGet 只在缺失时调用 Supplier。get 在空时抛异常，通常应改用 orElseThrow、map 或明确分支。方法若声明返回 Optional，就不应该再返回 null。[Optional API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html)说明了用法边界。

Optional 不表示请求失败原因，也不适合把所有实体字段和参数机械包装。找不到任务可以是空，数据库无法访问应保留失败，两者不能混为一谈。

## 6. 练习与答案

### 6.1 peek 打日志能保证每个元素都有日志吗

不能。短路、优化和异常都会改变执行范围，某些阶段可以被省略。需要业务必做的操作应显式安排在保证执行的流程中。

### 6.2 为什么 parallelStream 往共享列表 add 不安全

多个线程同时修改非线程安全容器，且没有正确归并协议。使用适当 Collector，或重新设计并行任务边界，不能靠流语法自动获得安全性。

### 6.3 没有任务与查询异常都返回 Optional.empty 合理吗

通常不合理。前者是成功查询后的缺失，后者是未能确定结果。应让调用者区分，否则可能把基础设施失败当作业务事实。

## 7. 继续阅读

- [Collectors API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html)
- [BigDecimal 与 java.time](./10-BigDecimal与java-time.md)
