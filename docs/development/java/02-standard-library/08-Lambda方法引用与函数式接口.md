---
title: "Lambda、方法引用与函数式接口"
sidebar_label: "08. Lambda、方法引用与函数式接口"
sidebar_position: 8
description: "从传递行为理解目标类型、Predicate/Function/Consumer/Supplier、方法引用、变量捕获、异常与回调生命周期。"
tags: [Java, Lambda, 函数式接口, 方法引用]
---

# Lambda、方法引用与函数式接口

把“如何筛选任务”传给方法，比为每种筛选条件写一个类更简洁。Lambda 是对函数式接口实现的表达式：它描述一段待调用行为，并不会因为写出来就自动执行、异步运行或创建新线程。

本篇使用 JDK 25，先明确行为的输入、输出与调用时机。

## 1. 函数式接口与目标类型

函数式接口具有一个抽象方法所代表的函数描述；default/static 方法不因此破坏资格，继承与 Object 方法还存在规范规定的合并规则。`@FunctionalInterface` 让编译器验证设计意图。

| 接口 | 输入与输出 | 典型用途 |
| --- | --- | --- |
| `Predicate<T>` | T → boolean | 校验和筛选 |
| `Function<T,R>` | T → R | 转换 |
| `Consumer<T>` | T → 无返回值 | 消费与副作用 |
| `Supplier<T>` | 无参数 → T | 延迟提供值 |
| `UnaryOperator<T>` | T → T | 同类型变换 |

Lambda 的类型由赋值或调用上下文决定，不能写 `var fn = x -> x + 1` 就期待编译器凭空选择接口。primitive 专用接口如 IntPredicate 可减少装箱。

## 2. 调用与捕获实验

```java title="LambdaDemo.java"
import java.util.List;
import java.util.Locale;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

public class LambdaDemo {
    record Task(String title, int priority) {}

    static long count(List<Task> tasks, Predicate<Task> rule) {
        long result = 0;
        for (Task task : tasks) {
            if (rule.test(task)) result++;
        }
        return result;
    }

    public static void main(String[] args) {
        int threshold = 2;
        Predicate<Task> urgent = task -> task.priority() <= threshold;
        var tasks = List.of(new Task("backup", 1), new Task("report", 5));
        System.out.println("urgent=" + count(tasks, urgent));
        Function<Task, String> title = Task::title;
        Function<Task, String> upper = title.andThen(value -> value.toUpperCase(Locale.ROOT));
        System.out.println("mapped=" + upper.apply(tasks.getFirst()));
        int[] calls = {0};
        Supplier<Integer> lazy = () -> ++calls[0];
        System.out.println("before=" + calls[0]);
        System.out.println("first=" + lazy.get());
        System.out.println("second=" + lazy.get());
        Predicate<Task> named = task -> task.title().startsWith("back");
        System.out.println("combined=" + urgent.and(named).test(tasks.getFirst()));
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out LambdaDemo.java
java -cp out LambdaDemo
```

```text title="expected-output"
urgent=1
mapped=BACKUP
before=0
first=1
second=2
combined=true
```

Supplier 不等于缓存，同一个 get 可以每次重新计算。示例捕获数组只为观察调用时机，不是并发安全计数方案。字符串大小写的生产规则应按[编码专题](./02-字符串Unicode编码与正则.md)选择明确 Locale。

## 3. effectively final 限制了什么

Lambda 捕获的局部变量必须 final 或事实上不再重新赋值。若在创建 urgent 后写 `threshold = 3`，就不再满足条件。

捕获的是局部变量的值；引用变量的值是对象引用，所以仍能修改它指向的数组或对象。限制重新赋值不等于对象不可变，也不保证并发可见性。

Lambda 中的 this 按外围上下文解释，不像匿名类那样引入自己的 this。回调若捕获服务对象、大数组或请求正文，还会延长它们的存活时间，排查内存时需要考虑这些引用链。[JLS Lambda](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.27)给出语言规则。

## 4. 方法引用的四种常见形式

`Type::staticMethod` 引用静态方法；`object::method` 绑定指定对象；`Type::instanceMethod` 把接收者作为函数参数；`Type::new` 引用构造方法。都需要与目标接口的签名匹配。

Task::title 对应“接收 Task，返回 String”，不是立即读取某个 Task。方法引用只是合适时更简洁的写法，不应该为了简短隐藏额外转换、异常或状态变化。

## 5. 异常、身份与执行环境

Function.apply 不声明 IOException，因此不能直接在其实现中无处理地调用抛 IOException 的方法。可以选择声明受检异常的自定义接口、在边界处理，或在保留 cause 的前提下转换；不要静默吞掉。

不要用 Lambda 对象的 `==`、实现类名或序列化形式做业务身份。它们的实现与复用方式不适合作为协议。回调在哪个线程、执行几次、能否重入，都由接收该回调的 API 决定。

## 6. 练习与答案

### 6.1 Predicate.and 的第二条件一定执行吗

不一定。它按短路逻辑组合，第一个为 false 时不执行第二个。因此不要依赖每次条件判断都执行的副作用。

### 6.2 为什么捕获 final List 仍能 add

final 限制引用重新赋值，不冻结列表。多线程同时 add 还需要正确同步或合适并发结构。

### 6.3 Supplier 创建后没有 get，方法体会执行吗

不会因创建自动执行。真正执行发生在调用 get 时，但创建表达式本身的参数求值等仍按普通表达式规则发生。

## 7. 继续阅读

- [函数式接口包](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/package-summary.html)
- [Stream、Collector 与 Optional](./09-Stream-Collector与Optional.md)
