---
title: "List、Tuple、Dict、Set 的使用与成本"
sidebar_label: "07. List、Tuple、Dict、Set 与成本"
sidebar_position: 7
description: "按顺序、键、唯一性和访问成本选择 Python 容器，理解切片、排序、字典视图、哈希键与共享引用。"
tags: [Python, List, Tuple, Dict, Set, 数据结构]
---

# List、Tuple、Dict、Set 的使用与成本

容器不只是括号不同。它们表达不同的数据关系：有位置的序列、固定位置的记录、按键关联的数据、只关心唯一性的集合。选择容器时先看关系和操作，再看写法是否简短。

## 1. 四种容器各回答什么问题

| 类型 | 主要关系 | 顺序与修改 | 常见用途 |
| --- | --- | --- | --- |
| List `[]` | 按位置排列的元素 | 有序，可修改 | 工作列表、顺序结果 |
| Tuple `()` | 固定位置的元素组合 | 有序，位置引用不可改 | 简单记录、复合键 |
| Dict `{}` | 键到值的映射 | 保持插入顺序，可修改 | 索引、计数、配置 |
| Set `set()` | 不重复的元素集合 | 无序，可修改 | 去重、成员判断、交并差 |

空 `{}` 是字典；空集合用 `set()`。单元素 Tuple 写作 `(value,)`，逗号是关键，单独的 `(value)` 只是括号表达式。

“无序”不是每次打印都随机变化，而是没有可依赖的序列位置/插入顺序契约。需要稳定展示集合时，必须按合适规则排序。

## 2. 完整示例：处理服务清单

```python title="containers_demo.py"
def main():
    names = ["api", "worker", "api"]
    ordered_unique = list(dict.fromkeys(names))
    print("unique:", ordered_unique)

    counts = {}
    for name in names:
        counts[name] = counts.get(name, 0) + 1
    print("counts:", counts)

    by_name = {"api": 8000, "worker": 9000}
    keys = by_name.keys()
    by_name["metrics"] = 9100
    print("live keys:", list(keys))
    print("missing:", by_name.get("admin"))
    print("present:", "admin" in by_name)

    required = {"api", "worker"}
    actual = {"api", "metrics"}
    print("missing services:", sorted(required - actual))
    print("common:", sorted(required & actual))
    ports = [443, 80, 8080]
    print("sorted:", sorted(ports))
    print("original:", ports)
    print("sort return:", ports.sort())
    print("in place:", ports)

if __name__ == "__main__":
    main()
```

```text title="containers_demo.out"
unique: ['api', 'worker']
counts: {'api': 2, 'worker': 1}
live keys: ['api', 'worker', 'metrics']
missing: None
present: False
missing services: ['worker']
common: ['api']
sorted: [80, 443, 8080]
original: [443, 80, 8080]
sort return: None
in place: [80, 443, 8080]
```

`dict.fromkeys` 用于保留首次出现顺序的去重，要求元素可哈希。这里值默认为 `None`，不存在可变默认值共享问题；不要直接用 `dict.fromkeys(names, [])` 创建彼此独立的列表，那会让各键共享同一个列表。

`keys` 是动态视图，反映字典后续变化，不是快照；`list(by_name)` 才是当时键序列的浅副本。

## 3. 序列：位置、切片与排序

`items[-1]` 表示最后一项，空序列会抛 `IndexError`。`items[start:stop]` 左闭右开；List 切片会创建新外层列表，但不会深复制其元素。

`append(x)` 添加一个元素，`extend(iterable)` 逐项添加。将字符串传给 `extend` 会逐字符添加，不会当成一个完整字符串。

`list.sort()` 原地修改并返回 `None`；`sorted(iterable)` 返回新列表。Python 排序是稳定的：比较键相同的元素保留原先相对顺序。但稳定不等于自动定义业务排序，时间、优先级和次级键仍应通过 `key` 明确。

Tuple 不可变的是位置引用，不是整个对象图，参见[对象与复制](./03-变量对象引用可变性与复制.md)。字段越来越多时，`record[5]` 很难维护，后续应使用命名记录或领域对象，而不是无限扩大 Tuple。

## 4. 字典键与缺失

`mapping[key]` 缺失时抛 `KeyError`；`get(key)` 默认返回 `None`。如果字典里本来允许存储 `None`，仅看 `get` 结果无法区分“键缺失”和“值是 None”，应使用 `key in mapping` 或独立哨兵。

键需要可哈希，List、Dict、Set 不能直接作为普通字典键。Tuple 是否可哈希取决于其元素。`1`、`1.0`、`True` 值相等且哈希一致，用作同一字典键时不会得到三个独立条目；输入模型若区分这些含义，要先避免这种混用。

字典保持插入顺序不是按键大小排序。更新已有键不会将它移到末尾；删除再插入则重新建立插入位置。

## 5. 集合运算与输出顺序

`a | b` 是并集，`a & b` 是交集，`a - b` 是差集，`a ^ b` 是对称差。元素需要可哈希，若需要不可变集合可以使用 `frozenset`。

用集合去重会丢失原序列顺序。日志、签名输入和快照测试不要直接依赖集合的打印顺序；也不要给语义上不可比较的混合元素直接 `sorted`，应先建立排序规则。

## 6. 成本：常见 CPython 容器的预期模型

以下用于选型，不是所有 Python 实现、所有哈希分布下的绝对承诺：

| 操作 | 通常成本 | 原因/边界 |
| --- | --- | --- |
| List 按下标访问 | O(1) | 定位元素引用 |
| List 尾部 append | 摊销 O(1) | 个别扩容需要分配/复制 |
| List 头部插入、删除 | O(n) | 后续元素引用移动 |
| List 成员查找 | O(n) | 可能逐项比较 |
| Dict/Set 查找 | 平均 O(1) | 哈希与相等成本、冲突会影响 |
| 排序 n 项 | 通常按 O(n log n) 估算 | CPython 排序可利用已有顺序，键函数也有成本 |
| 长度 k 的 List 切片 | O(k) | 新容器及 k 个元素引用 |

O(1) 不是零成本，也不代表一次整数查找与一次复杂对象查找一样快。大整数、长字符串的哈希/比较、对象分配和缓存局部性都影响实际性能。

队列需要频繁从头取元素时，可以考虑 `collections.deque`；不要因为 List 名字熟悉，就用 `pop(0)` 实现大队列。

## 7. 练习与答案

### 7.1 为什么 result = items.sort() 得到 None？

答案：`sort` 原地修改，返回 `None` 用于强调它不是新列表。要保留原列表使用 `result = sorted(items)`。

### 7.2 怎样区分键缺失与键存在但值为 None？

答案：先用 `key in mapping` 判断存在性，或使用 `sentinel = object()` 再 `mapping.get(key, sentinel)` 并通过 `is` 判断。不要拿一个可能合法出现的普通值充当哨兵。

### 7.3 需要保留首次出现顺序，能直接 list(set(items)) 吗？

答案：不能保证所需顺序。元素可哈希时可以用 `list(dict.fromkeys(items))`；复杂对象需要按明确的业务唯一键去重。

## 8. 参考资料

- [数据结构教程](https://docs.python.org/3.14/tutorial/datastructures.html)
- [内置容器](https://docs.python.org/3.14/library/stdtypes.html)
- [排序指南](https://docs.python.org/3.14/howto/sorting.html)
- [collections.deque](https://docs.python.org/3.14/library/collections.html#collections.deque)
