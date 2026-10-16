---
title: "Enum、Record、Sealed 与模式匹配"
sidebar_label: "11. Enum、Record、Sealed 与模式匹配"
sidebar_position: 11
description: "使用有限状态、数据载体和封闭结果类型建模，理解 record 校验、sealed 分支穷尽与模式匹配的边界。"
tags: [Java, Enum, Record, Sealed, 模式匹配]
---

# Enum、Record、Sealed 与模式匹配

任务状态只有几个合法值，提交结果可能是成功或拒绝，而每种结果携带的数据不同。用字符串和一堆可空字段表达这些约束，错误往往直到运行时才暴露。enum、record 与 sealed 可以把部分规则交给类型系统。

示例使用 JDK 25 正式功能，不需要开启 Preview。

## 1. 三种类型分别解决什么

| 机制 | 描述对象 | 不能自动解决的事情 |
| --- | --- | --- |
| enum | 一组具名的有限实例，例如任务状态 | 状态迁移是否合法、外部字符串是否有效 |
| record | 由组件描述的数据载体 | 深度不可变、任意业务身份定义 |
| sealed | 限定直接子类型的类型层次 | 所有实现一定不可变或线程安全 |

enum 可以有字段和方法。不要把 ordinal 当数据库长期协议：在中间插入常量就会改变后续序号。外部协议使用显式稳定编码，并处理未知值。

record 为组件提供访问器、构造与基于组件的相等性等行为；访问器是 `id()` 而非自动生成 `getId()`。record 隐式 final，不能继承其他业务类，但可以实现接口。规则见 [JLS 类与 record](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.10)。

## 2. 用封闭结果代替可空字段组合

```text
SubmitResult
├── Accepted(id)       成功必须携带标识
└── Rejected(reason)   拒绝必须携带原因
```

调用者不再需要猜测 `id == null` 是否表示失败。sealed 限定直接实现类；这些类必须按规则继续声明为 final、sealed 或 non-sealed。具名模块内的直接子类必须属于同一模块；未命名模块中还要求同包。

## 3. 完整实验

```java title="ModelDemo.java"
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

public class ModelDemo {
    enum State { READY, DONE }

    sealed interface SubmitResult permits Accepted, Rejected {}
    record Accepted(long id) implements SubmitResult {}
    record Rejected(String reason) implements SubmitResult {}

    record Task(String title, List<String> labels) {
        Task {
            title = Objects.requireNonNull(title).strip();
            if (title.isEmpty()) {
                throw new IllegalArgumentException("empty title");
            }
            labels = List.copyOf(labels);
        }
    }

    static String describe(SubmitResult result) {
        return switch (result) {
            case Accepted(long id) -> "accepted:" + id;
            case Rejected(String reason) -> "rejected:" + reason;
        };
    }

    public static void main(String[] args) {
        var labels = new ArrayList<>(List.of("daily"));
        Task task = new Task(" backup ", labels);
        labels.add("external");
        System.out.println("title=" + task.title());
        System.out.println("labels=" + task.labels());
        System.out.println("equal=" + task.equals(new Task("backup", List.of("daily"))));
        System.out.println(describe(new Accepted(7)));
        System.out.println(describe(new Rejected("quota")));
        System.out.println("state=" + State.valueOf("READY"));
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out ModelDemo.java
java -cp out ModelDemo
```

```text title="expected-output"
title=backup
labels=[daily]
equal=true
accepted:7
rejected:quota
state=READY
```

紧凑构造方法在自动字段赋值前校验和规范化参数。这里 `labels = List.copyOf(labels)` 改的是构造参数，后续隐式赋值才把它保存到组件字段；不是给 final 字段重新赋值。

## 4. 浅不可变与防御性复制

record 的组件字段不能被重新赋值，但引用的对象仍可能变化。`record Task(List<String> labels)` 不加复制时，外部持有原列表仍能影响它。

List.copyOf 保护容器结构，不递归复制元素。示例使用不可变 String，因此组合后可稳定表达标签值；如果列表元素是可变 Task，仍需为元素设计不可变值或明确共享规则。

自动 equals 使用所有组件。这适合快照和值对象；若业务身份只看 id，而其他字段可以变化，未必应该直接采用 record 的默认相等性。

## 5. 模式匹配与穷尽性

`case Accepted(long id)` 同时匹配类型并解构组件。由于 sealed 的直接分支可知，编译器可以检查 switch 表达式是否覆盖已知变体。增加一个新变体后，应重新编译并处理受影响的调用方。

模式的顺序仍重要：宽泛类型放在前面可能支配后面的特定分支，导致编译错误。`when` 守卫可以限制某个模式，但带条件分支不能随意当作完整覆盖。

普通类型模式不匹配 null。本例明确要求 result 非 null；传 null 会失败。确实允许空值时，增加显式 `case null` 或先做非空校验，不能把“穷尽 sealed 类型”误解为“自动处理 null”。详见 [JLS switch 与模式](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.11)。

## 6. 边界上的字符串转换

`State.valueOf` 要求名称精确匹配，未知名称抛 IllegalArgumentException。处理外部输入时应提供稳定解析函数，明确大小写、空值和未知编码策略。

sealed 适合有限的领域结果、表达式树和协议变体；开放插件生态通常需要可扩展接口。不是所有接口都应封闭，也不是所有类都应改成 record。

## 7. 练习与答案

### 7.1 给 Accepted 新增一个子类是否可行

不可行。record 隐式 final。可以给 SubmitResult 增加另一个允许的直接实现，并同步修改 permits 和需要覆盖结果的代码。

### 7.2 增加 RetryLater 后，describe 为什么可能编译失败

原 switch 不再穷尽所有允许变体。增加对应分支，并定义它如何携带重试信息。不要为了消除报错随手加一个吞掉未来类型的 default。

### 7.3 labels 换成 List 可变元素，List.copyOf 是否足够

只能隔离容器结构，不能冻结元素。需要不可变元素或逐项防御性复制，并确保访问器不会泄露可修改内部状态。

## 8. 继续阅读

- [不可变对象、组合与依赖边界](./12-不可变对象组合与依赖边界.md)
- [Enum API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Enum.html)
