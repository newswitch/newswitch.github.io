---
title: "TreeMap、TreeSet 与 Comparator 的排序规则"
sidebar_label: "05. TreeMap、TreeSet 与 Comparator"
sidebar_position: 5
description: "理解红黑树索引、比较器契约、排序相等与 equals、范围视图、最近键查找及复合排序的正确实现。"
tags: [Java, TreeMap, TreeSet, Comparator]
---

# TreeMap、TreeSet 与 Comparator 的排序规则

按任务 id 查找通常可以用哈希表；要查询某个时间范围、找不晚于截止时间的最近任务，就需要有序索引。TreeMap 保留键的比较顺序，TreeSet 使用同样的排序思想维护元素。

本篇使用 JDK 25。最重要的规则是：树结构用“比较结果为 0”判断同一个键，不一定使用 equals。

## 1. 有序索引与排序列表

TreeMap 以红黑树维护有序键，get/put/remove 的时间复杂度为对数级。它适合持续更新和范围查找；一次性读取后排序的列表，可能更简单、遍历更紧凑。

```text
键顺序：10 → 20 → 30
floorKey(25)   = 20   不大于目标的最大键
ceilingKey(25) = 30   不小于目标的最小键
lowerKey(20)   = 10   严格小于
higherKey(20)  = 30   严格大于
```

firstKey/lastKey 在空表抛异常；firstEntry/lastEntry 可以返回 null。按业务区分“没有结果”和非法输入，不要假设永远存在相邻键。

## 2. Comparator 的零值是一种身份定义

只按标题长度排序时，`"db"` 与 `"io"` 比较为 0，TreeSet 会把它们视为同一个元素。若业务仍需区分，应增加第二比较条件。

比较器应满足符号反对称、传递性以及零值比较的一致规则。要遵守普通 Map/Set 的一般契约，排序相等还应与 equals 一致。详见 [Comparator API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html)。

不要写 `a.priority - b.priority` 作为通用比较器，整数溢出会破坏排序；使用 Integer.compare 或 comparingInt。处理 null 时应显式选择 nullsFirst/nullsLast，不能等待排序过程偶发 NPE。

## 3. 范围视图与复合排序实验

```java title="SortedDemo.java"
import java.util.Comparator;
import java.util.TreeMap;
import java.util.TreeSet;

public class SortedDemo {
    public static void main(String[] args) {
        var deadlines = new TreeMap<Integer, String>();
        deadlines.put(10, "backup");
        deadlines.put(20, "verify");
        deadlines.put(30, "archive");
        System.out.println("floor=" + deadlines.floorKey(25));
        System.out.println("ceiling=" + deadlines.ceilingKey(25));
        var window = deadlines.subMap(10, true, 30, false);
        System.out.println("window=" + window.keySet());
        window.remove(20);
        System.out.println("original=" + deadlines.keySet());

        var lengthOnly = new TreeSet<String>(Comparator.comparingInt(String::length));
        lengthOnly.add("db");
        lengthOnly.add("io");
        System.out.println("lengthOnlySize=" + lengthOnly.size());
        var distinct = new TreeSet<String>(
                Comparator.comparingInt(String::length).thenComparing(Comparator.naturalOrder()));
        distinct.add("io");
        distinct.add("db");
        distinct.add("cpu");
        System.out.println("distinct=" + distinct);
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out SortedDemo.java
java -cp out SortedDemo
```

```text title="expected-output"
floor=20
ceiling=30
window=[10, 20]
original=[10, 30]
lengthOnlySize=1
distinct=[db, io, cpu]
```

subMap 不是独立副本，而是原 Map 的范围视图。通过视图删除，原 Map 同步变化；向视图插入范围外键会被拒绝。需要独立结构时使用新的 TreeMap 或其他明确复制操作。[TreeMap API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html)给出了区间端点规则。

## 4. 哪些变化会破坏索引

元素入树后修改参与比较的字段，树的物理位置不会自动跟着变化。结果可能是 contains 查不到、遍历顺序错误。应使用不可变排序键，或先移除、修改后重新加入。

比较器依赖当前时间、可变配置或外部查询，也会让同一对元素的顺序不稳定。比较器应保持确定、快速且无副作用；不能在比较中访问数据库来决定优先级。

BigDecimal 是一个特别值得注意的例子：`1.0` 与 `1.00` 的 compareTo 为 0，但 equals 为 false，因此放入 TreeSet 与 HashSet 可能得到不同数量。应先统一业务数值语义，而不是把某个集合结果当作绝对标准。

## 5. 练习与答案

### 5.1 reversed 放在比较链最后，反转哪些条件

如果对完整链调用 reversed，会反转整条比较顺序。只想第一条件降序、第二条件升序，应先反转第一比较器，再 thenComparing 第二比较器。

### 5.2 subMap 的默认端点是否都包含

两个参数的常见重载是包含起点、不包含终点。需要明确行为时使用带布尔参数的重载，并为起点、终点和范围外值写测试。

### 5.3 TreeSet 为什么没有保存两个不同字符串

它按比较结果判定重复。检查比较器是否遗漏业务区分维度，而不是只检查字符串 equals。

## 6. 继续阅读

- [Queue、Deque 与 PriorityQueue](./06-Queue-Deque与PriorityQueue.md)
- [TreeSet API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeSet.html)
