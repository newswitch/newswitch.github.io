---
title: "HashMap、LinkedHashMap 与 HashSet 的查找与顺序"
sidebar_label: "04. HashMap、LinkedHashMap 与 HashSet"
sidebar_position: 4
description: "从键查找过程理解哈希桶、碰撞、扩容、树化、负载因子、插入与访问顺序，以及可变键和缓存容量边界。"
tags: [Java, HashMap, LinkedHashMap, HashSet]
---

# HashMap、LinkedHashMap 与 HashSet 的查找与顺序

任务按 id 查找、标签去重和按访问顺序淘汰缓存，分别需要键值映射、集合和有序映射。它们都可能使用哈希，但“查得快”“有顺序”“缓存不会无限增长”是不同能力。

本篇使用 JDK 25，语言契约与 OpenJDK 实现细节分开说明。

## 1. get 如何找到键

![HashMap 的桶定位、碰撞与扩容](/img/development/hashmap.svg)

桶数组与桶内结构分开：前者决定定位范围，后者处理同桶比较。扩容和可变键的影响也发生在这条查找路径上。

```text
key.hashCode → 扰动与桶定位
             → 桶内比较哈希、身份或 equals
             → 命中值 / 不存在
```

不同键可落入同一桶，称为碰撞。平均常数级查找依赖哈希分散和适当装载；不是任意键都能保证常数时间。键的 equals/hashCode 必须一致，相关规则见[相等性专题](../01-language/09-Object相等性与hashCode契约.md)。

HashSet 提供元素去重，OpenJDK 中由 HashMap 支撑。Map.get 返回 null 既可能表示没有键，也可能是键映射到 null；需要区分时再查 containsKey，或干脆在业务层禁止 null 值。

## 2. 容量、负载因子与树化

HashMap 的 size 是映射数量，capacity 是桶数组容量。默认负载因子为 0.75，达到相应阈值后需要扩容；扩容分配更大桶数组并重新分布节点，会带来内存与延迟成本。

JDK 25 可使用 `HashMap.newHashMap(expectedMappings)` 按预期映射数创建，避免把“构造器的初始容量”误当“无需扩容可放入的键数”。不要为几十个任务预分配几百万桶。[HashMap API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html)规定了公开行为。

在 [OpenJDK 25 GA 源码](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/util/HashMap.java)中，长桶可转为树结构，相关阈值包含 8、6 和最小树化容量 64。不能简化成“第 8 次碰撞必定树化”：插入路径、桶长度和表容量都影响行为，小表还可能先扩容。树化也不让所有恶劣键组合都拥有统一的常数性能。

## 3. 顺序与去重实验

```java title="MapDemo.java"
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class MapDemo {
    record TaskId(long value) {}

    public static void main(String[] args) {
        Map<TaskId, String> tasks = HashMap.newHashMap(10);
        tasks.put(new TaskId(7), "first");
        tasks.put(new TaskId(7), "updated");
        System.out.println("size=" + tasks.size());
        System.out.println("lookup=" + tasks.get(new TaskId(7)));

        var ordered = new LinkedHashMap<String, Integer>();
        ordered.put("b", 2);
        ordered.put("a", 1);
        ordered.put("b", 3);
        System.out.println("insertion=" + ordered.keySet());

        var access = new LinkedHashMap<String, Integer>(16, 0.75f, true);
        access.put("a", 1);
        access.put("b", 2);
        access.get("a");
        System.out.println("access=" + access.keySet());

        var labels = new HashSet<>(List.of("daily", "daily", "urgent"));
        System.out.println("unique=" + labels.size());
        ordered.merge("a", 10, Integer::sum);
        System.out.println("merged=" + ordered.get("a"));
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out MapDemo.java
java -cp out MapDemo
```

```text title="expected-output"
size=1
lookup=updated
insertion=[b, a]
access=[b, a]
unique=2
merged=11
```

HashMap/HashSet 的迭代顺序不作保证，示例不打印它们的完整顺序。LinkedHashMap 默认保留插入顺序，更新已有映射不会自动移到末尾；访问顺序模式中 get 会改变顺序，遍历期间访问也要谨慎。

## 4. merge 与 compute 的边界

merge 可表达累计，computeIfAbsent 可表达“缺少时构造值”。计算函数返回 null 时可能不建立映射或删除已有映射，必须理解具体方法契约。

普通 HashMap 的这些方法不提供多线程原子更新保证，也不应该在计算回调里递归修改同一个 Map。需要并发原子行为时选择相应并发容器，并检查其回调、可见性与复合操作规则。

## 5. LinkedHashMap 不等于完整缓存

访问顺序加 removeEldestEntry 可以实现简单数量上限，但不自动包含过期、按权重淘汰、并发加载去重或统计。缓存值很大时，“最多一万项”也可能耗尽内存。

放入后改变键的身份字段，会破坏定位。泄露 entrySet/keySet 等可写视图，也可能让调用者绕过业务约束。缓存键应稳定，输出边界应明确是否允许修改。

## 6. 练习与答案

### 6.1 HashMap 打印顺序一直相同，能当排序结果吗

不能。当前键值、容量和实现恰好产生该顺序；扩容或版本变化可能改变。需要插入顺序用 LinkedHashMap，需要键排序用 TreeMap。

### 6.2 哈希冲突是否会把旧值覆盖

单纯 hashCode 相同不会；还要按键相等性判断。相等键 put 才替换映射值，不相等键仍可共存。

### 6.3 访问顺序模式中的 get 为什么影响遍历

它会把相应条目移动到新的访问位置，可能构成结构修改。不要边迭代边通过 get 重排同一映射；需要时先生成独立快照。

## 7. 继续阅读

- [LinkedHashMap API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html)
- [TreeMap、TreeSet 与 Comparator](./05-TreeMap-TreeSet与Comparator.md)
