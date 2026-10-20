---
title: "collections、itertools 与 functools"
sidebar_label: "03. collections、itertools 与 functools"
sidebar_position: 3
description: "按计数、队列、分组、惰性组合和缓存需求选择标准库工具，理解各自的状态与内存成本。"
tags: [Python, 标准库, IO]
---

# collections、itertools 与 functools

标准库工具的价值是明确表达数据关系，而不只是缩短循环。选择工具前，先问它是否保存状态、是否一次性消费，以及输入规模能否超过内存。

## 1. 工具地图

| 工具 | 适用问题 | 容易遗漏的边界 |
| --- | --- | --- |
| Counter | 元素计数 | 与业务去重、频率窗口不同 |
| defaultdict | 缺失键自动建值 | 读取方式可能改变容器 |
| deque | 两端队列 | 有界 deque 满时可能丢另一端数据 |
| itertools | 组合迭代 | 惰性不等于无状态 |
| partial | 预绑定部分参数 | 保存对象引用 |
| lru_cache | 纯函数结果复用 | 键、内存、失效、多进程与并发 |

## 2. 可运行示例

```python title="io_tools.py"
from collections import Counter, defaultdict, deque
from functools import lru_cache, partial
from itertools import groupby

@lru_cache(maxsize=4)
def square(value):
    return value * value

def main():
    print(Counter(["a", "b", "a"]).most_common())
    groups = defaultdict(list)
    groups["a"].append(1)
    print(dict(groups))
    window = deque(maxlen=2)
    window.extend([1, 2, 3])
    print(list(window))
    print([(key, list(values)) for key, values in groupby("aabba")])
    print(partial(pow, 2)(3))
    square.cache_clear()
    square(3)
    square(3)
    print(square.cache_info().hits)

if __name__ == "__main__":
    main()
```

```text title="io_tools.out"
[('a', 2), ('b', 1)]
{'a': [1]}
[2, 3]
[('a', ['a', 'a']), ('b', ['b', 'b']), ('a', ['a'])]
8
1
```

`groupby` 分组的是相邻相同键，不会把最后一个 a 自动并进第一组；若需要全局分组，应先按规则排序或使用映射。返回的小组迭代器还共享上游，想保留到以后使用需要明确消费或物化。

## 3. 队列不只考虑速度

deque 两端操作适合 FIFO/LIFO，但它不是带工作完成、等待与关闭协议的任务队列。线程通信通常还需要 `queue.Queue`，异步通信需要 `asyncio.Queue`。

`maxlen` 满后淘汰适合滑动窗口，却不适合不能丢失的待执行任务。后者需要背压或拒绝机制，不能静默淘汰。

## 4. 缓存的正确性

缓存键必须包含所有影响结果的条件，例如租户与配置版本；返回可变列表后由调用方修改，可能污染后续命中结果。缓存会保留键和值的引用，需限制容量并定义失效。

`lru_cache` 的内部一致性不代表同一个键的首次计算只能执行一次，更不提供跨进程一致缓存。具有写入副作用的函数不应直接靠它实现幂等。

## 5. 练习与答案

### 5.1 groupby 为什么出现两组 a？

答案：它只合并相邻同键元素。全局分组需要先排序或使用按键累积的容器。

### 5.2 maxlen 的 deque 适合保存待执行订单吗？

答案：通常不适合。满时会自动丢另一端元素；订单需要明确拒绝、持久化或背压。

### 5.3 缓存函数读取当前租户，但键只有 job_id，会怎样？

答案：不同租户可能共享错误结果，甚至泄露数据。键必须反映完整上下文，或使用适当隔离的实例缓存。

## 6. 参考资料

- [collections](https://docs.python.org/3.14/library/collections.html)
- [itertools](https://docs.python.org/3.14/library/itertools.html)
- [functools](https://docs.python.org/3.14/library/functools.html)
