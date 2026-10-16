---
title: "ArrayList 与 LinkedList 的结构、扩容与选型"
sidebar_label: "03. ArrayList 与 LinkedList"
sidebar_position: 3
description: "结合数组与双向链表解释访问、移动、扩容、迭代器插入、缓存局部性、remove 重载和批量删除。"
tags: [Java, ArrayList, LinkedList, 数据结构]
---

# ArrayList 与 LinkedList 的结构、扩容与选型

“查询多用数组，增删多用链表”忽略了一个关键成本：先找到要修改的位置。按下标删除 LinkedList 的中间元素，仍然需要走过节点；它并不会自动比 ArrayList 快。

本篇使用 JDK 25，从一次具体操作的完整路径分析集合，而不是只背复杂度表。

## 1. 两种布局

```text
ArrayList：Object[] → [引用A][引用B][引用C][空槽]
LinkedList：头 → 节点A ⇄ 节点B ⇄ 节点C ← 尾
                      每个节点保存元素和前后链接
```

ArrayList 的连续存储对象是引用数组，不代表被引用的业务对象也连续。LinkedList 需要额外节点与指针，遍历包含指针追踪，可能增加分配、GC 和缓存未命中。

## 2. 一次操作包含哪些成本

| 操作 | ArrayList | LinkedList |
| --- | --- | --- |
| get(index) | 常数级下标访问 | 从较近端遍历，最坏线性 |
| 尾部添加 | 摊销常数，扩容时线性复制 | 链接尾节点，常数级 |
| 按下标中间插入 | 移动后续引用，线性 | 定位线性，链接调整常数 |
| 迭代器已在目标处插入 | 移动后续引用 | 链接调整常数 |
| 遍历所有元素 | 线性 | 线性，但内存访问模式不同 |

摊销常数不等于每次都快。ArrayList 偶尔重新分配更大的数组并复制引用，单次延迟会增加。预估规模后设置初始容量或 ensureCapacity 可以减少扩容，但容量不是 size，也不会创建业务元素。

具体增长比例是实现细节，不能作为跨 JDK 契约。容量过大还会占用引用数组内存。[ArrayList API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html)只给出相应操作和性能约定。

## 3. 删除重载与迭代器实验

```java title="ListDemo.java"
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;

public class ListDemo {
    public static void main(String[] args) {
        var values = new ArrayList<>(List.of(10, 20, 30));
        values.ensureCapacity(100);
        System.out.println("size=" + values.size());
        values.remove(1);
        System.out.println("byIndex=" + values);
        values.remove(Integer.valueOf(10));
        System.out.println("byValue=" + values);

        var linked = new LinkedList<>(List.of("a", "c"));
        var iterator = linked.listIterator();
        iterator.next();
        iterator.add("b");
        System.out.println("inserted=" + linked);
        linked.removeIf("b"::equals);
        System.out.println("filtered=" + linked);

        List<Integer> emptyWithCapacity = new ArrayList<>(100);
        System.out.println("capacityIsNotSize=" + emptyWithCapacity.isEmpty());
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out ListDemo.java
java -cp out ListDemo
```

```text title="expected-output"
size=3
byIndex=[10, 30]
byValue=[30]
inserted=[a, b, c]
filtered=[a, c]
capacityIsNotSize=true
```

`remove(1)` 选择 int 下标重载；`remove(Integer.valueOf(10))` 选择对象重载，删除第一个相等元素。这个差异来自 Java 重载解析，不是集合随机行为。

## 4. 遍历方式也会改变复杂度

```java
// 反例片段：对 LinkedList 重复按下标定位，可能退化为平方级工作。
for (int i = 0; i < linked.size(); i++) {
    System.out.println(linked.get(i));
}
```

需要顺序读取时使用增强 for 或 Iterator。需要遍历中删除时使用迭代器 remove 或 removeIf，而不是对列表直接 remove 后继续使用旧迭代器。批量删除还应考虑实现是否需要反复移动元素。

RandomAccess 标记可帮助通用算法判断是否适合下标访问，但不是线程安全、实时性或缓存命中保证。

## 5. 如何做实际选型

默认有序可变列表通常先选择 ArrayList。需要 FIFO/LIFO 两端操作时，优先评估 ArrayDeque，不必因为 LinkedList 实现 Deque 就直接选它。

LinkedList 更适合确实需要链表语义、且操作位置已通过迭代器定位的场景。要同时计算节点内存、遍历和分配成本。性能比较必须使用相同数据量、操作分布和 JVM 预热，不能只计一次纳秒耗时。

两者都不提供普通并发读写安全。synchronized 包装或并发容器的选择需要根据复合操作的一致性决定，不能把线程安全等同于“每个单独方法不会崩”。

## 6. 练习与答案

### 6.1 new ArrayList(100) 后能立即 set(50, value) 吗

不能。容量至少能容纳相应数量，但 size 仍为 0。set 只能替换已有元素，应先 add 或用明确方式初始化逻辑元素。

### 6.2 中间删除非常多就一定选 LinkedList 吗

不一定。若每次按随机下标定位，链表也要线性遍历；ArrayList 的引用搬运有较好的局部性。先分析定位方式、批量操作和数据规模，再测量。

### 6.3 clear 后内存一定立即全部释放吗

元素引用会被移除，但业务对象是否回收取决于其他引用和 GC；ArrayList 的底层容量通常仍保留。确需缩容时再考虑 trimToSize，避免频繁缩扩造成抖动。

## 7. 继续阅读

- [LinkedList API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedList.html)
- [HashMap、LinkedHashMap 与 HashSet](./04-HashMap-LinkedHashMap与HashSet.md)
