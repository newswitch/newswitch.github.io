---
title: "Object、相等性与 hashCode 契约"
sidebar_label: "09. Object、相等性与 hashCode"
sidebar_position: 9
description: "区分对象身份与业务相等，理解 equals 和 hashCode 契约、继承对称性、数组比较及可变键失效。"
tags: [Java, Object, equals, hashCode]
---

# Object、相等性与 hashCode 契约

两个任务对象可以不是同一个实例，却代表同一条任务。`==` 回答“是不是同一个对象”，`equals` 回答类型自己定义的“是否相等”。集合去重、缓存查找和测试断言，都依赖这一区别。

本篇使用 JDK 25。先阅读[类与对象](./06-类对象构造方法与封装.md)，再把下面的 TaskId 看成任务的身份，而不是任务的全部可变状态。

## 1. 身份与值是两套问题

基本类型的 `==` 比较相应数值或布尔值；引用类型的 `==` 比较引用身份。Object 默认的 equals 也比较身份，子类可以覆盖它。

```text
a ──→ TaskId("daily") ←── same
b ──→ TaskId("daily")

a == same 为 true
a == b 为 false
a.equals(b) 由 TaskId 的相等规则决定
```

String 覆盖 equals，比较字符内容；数组没有因此获得元素比较语义，需要 `Arrays.equals`，嵌套数组按需求使用 `Arrays.deepEquals`。不能根据打印结果相同推断对象相等。

## 2. equals 为什么必须配合 hashCode

equals 应满足自反、对称、传递、一致以及与 null 不相等。hashCode 的关键约束是：**equals 相等的对象必须具有相同哈希码**；反过来不成立，不同对象可以碰撞。

哈希表先根据哈希码缩小搜索位置，再用相等性确认目标。如果相等的两个键被分配到不同搜索位置，调用者用“相等的新键”就可能找不到旧值。哈希码不是对象地址、唯一编号或加密摘要，也不保证跨进程稳定。规则见 [Object API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html)。

## 3. 完整实验

```java title="EqualityDemo.java"
import java.util.Arrays;
import java.util.HashSet;
import java.util.Objects;

public class EqualityDemo {
    static final class TaskId {
        private final String value;

        TaskId(String value) {
            this.value = Objects.requireNonNull(value);
        }

        @Override
        public boolean equals(Object other) {
            return this == other
                    || other instanceof TaskId id && value.equals(id.value);
        }

        @Override
        public int hashCode() {
            return value.hashCode();
        }

        @Override
        public String toString() {
            return "TaskId[" + value + "]";
        }
    }

    public static void main(String[] args) {
        TaskId a = new TaskId("daily");
        TaskId b = new TaskId("daily");
        var ids = new HashSet<TaskId>();
        ids.add(a);
        ids.add(b);
        System.out.println("same=" + (a == b));
        System.out.println("equal=" + a.equals(b));
        System.out.println("sameHash=" + (a.hashCode() == b.hashCode()));
        System.out.println("unique=" + ids.size());
        System.out.println("lookup=" + ids.contains(new TaskId("daily")));
        System.out.println("arrayEqual=" + Arrays.equals(new int[]{1}, new int[]{1}));
        System.out.println("nullEqual=" + Objects.equals(null, null));
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out EqualityDemo.java
java -cp out EqualityDemo
```

```text title="expected-output"
same=false
equal=true
sameHash=true
unique=1
lookup=true
arrayEqual=true
nullEqual=true
```

final 类避免子类引入新的相等维度。不可变 value 避免对象进入集合后改变身份。`Objects.equals(a, b)` 便于处理可能为 null 的引用，但不能替一个写错的 equals 修复契约。

## 4. 继承为什么容易破坏对称性

假设父类 Point 只比较坐标，子类 ColorPoint 还比较颜色。父类认为某个子类与自己相等，子类却可能拒绝与父类相等，形成 `a.equals(b)` 与 `b.equals(a)` 不同。

解决方法不是不断增加 instanceof 分支，而是先决定类型的值语义：不允许扩展的值类型使用 final 或 record；可扩展层次则为整个层次设计一致的相等规则，或者改用组合。`getClass()` 严格比较运行时类型可以阻止跨类相等，但也会影响 ORM 代理等场景，不能机械替换。

## 5. 可变键与可变身份

把标题放进 equals/hashCode 后又允许改标题，键的当前哈希码就可能与插入时不同。此时遍历还能看到对象，contains/remove 却可能查不到。给 HashMap 加锁也解决不了这类契约错误。

更合适的任务模型是：稳定 TaskId 作为键；标题、进度等作为值的状态。如果业务确实需要更换键，应先移除旧键再插入新键，并处理并发与冲突。

## 6. toString 与复制的边界

toString 用于诊断，不应输出密码、令牌或完整敏感请求，也不应作为稳定持久化协议。日志里出现 `Type@abcd` 不等于拿到了对象物理地址。

Object.clone 默认是浅复制：新对象的引用字段仍可能指向原对象内部的数据。业务复制通常用构造方法、工厂或显式映射说明复制范围。对象生命周期应使用明确的资源关闭机制，不依赖已弃用待移除的 finalize。

## 7. 练习与答案

### 7.1 把 hashCode 固定返回 1，结果一定错吗

只要 equals 正确且相等对象都返回 1，契约没有被破坏，查找仍可以正确；大量碰撞会损害性能。哈希码分散性与正确性是两件事。

### 7.2 两个任务标题一样，是否应该 equals 相等

取决于业务身份。允许重名的任务不能只比较标题；不可变 TaskId 可以比较标识值。先定义“同一任务”，再实现相等性。

### 7.3 record 中有数组字段，就会按数组元素比较吗

不会。自动生成的 record 相等性遵循组件的相等规则，数组组件仍是引用相等。需要内容语义时应设计合适的不可变表示，或显式覆盖并同时保证 hashCode 一致。

## 8. 继续阅读

- [异常、传播与资源关闭](./10-异常传播与资源关闭.md)
- [HashMap、LinkedHashMap 与 HashSet](../02-standard-library/04-HashMap-LinkedHashMap与HashSet.md)
- [Objects 工具方法](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html)
