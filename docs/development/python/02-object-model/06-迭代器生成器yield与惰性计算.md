---
title: "迭代器、生成器、yield 与惰性计算"
sidebar_label: "06. 迭代器、生成器、yield 与惰性计算"
sidebar_position: 6
description: "理解迭代协议、生成器暂停恢复、一次性消费和资源关闭，避免把惰性计算误认为免费。"
tags: [Python, 对象模型, 编程原理]
---

# 迭代器、生成器、yield 与惰性计算

可迭代对象能提供迭代器；迭代器保存当前遍历状态；生成器是使用 `yield` 构造迭代器的一种方式。它们解决逐项处理，但不会自动解决内存上限、网络背压与资源关闭。

## 1. 协议与生命周期

`iter(value)` 获取迭代器，`next(iterator)` 获取下一项；耗尽时抛 `StopIteration`。List 可以重复创建迭代器，某一个生成器通常只能沿自己的状态前进一次。

调用生成器函数时，函数体尚未按普通函数那样执行到结束；取得的是生成器对象。第一次 `next` 才开始执行，遇到 `yield` 暂停，下次继续。

## 2. 暂停、耗尽与关闭

```python title="objects_generator.py"
def values():
    print("start")
    try:
        yield 10
        print("resume")
        yield 20
    finally:
        print("cleanup")

def main():
    stream = values()
    print("created")
    print(next(stream))
    stream.close()
    print(list(stream))
    print(list(value * 2 for value in range(3)))

if __name__ == "__main__":
    main()
```

```text title="objects_generator.out"
created
start
10
cleanup
[]
[0, 2, 4]
```

`close` 让暂停处进入关闭流程，执行 `finally`。后续再遍历已关闭生成器得到空结果。不要只依赖垃圾回收最终关闭它，尤其是生成器持有文件、连接或锁时。

## 3. 惰性节省的是哪部分成本

列表推导式立即物化所有结果；生成器表达式按需产生元素，可以避免同时保存所有中间结果。但每次迭代仍要执行计算，且上游可能已经保存了完整数据。

`list(generator)` 会重新物化；`sorted(generator)` 为排序也需要收集结果。`itertools.tee` 为让多个消费者独立前进，可能缓存两者进度差，不能把它看成零成本复制。

一次性输入如果先用于日志打印，再用于业务循环，第二次可能已经没有数据。日志应该记录摘要或在明确可承受的范围内物化，而不是悄悄消费输入。

## 4. send、yield from 与异常

`send(value)` 将值送回暂停的 `yield` 表达式；首次启动一般需要 `next` 或 `send(None)`。`yield from` 可以委托子迭代器，并传递相关迭代行为，不只是一个简写的双层 for。

生成器结束应使用 `return` 或自然结束，不要在内部随意抛 `StopIteration`；它可能被转换为 `RuntimeError`。复杂双向协议应明确状态，否则可读性通常不如普通对象。

异步生成器使用 `async for` 与异步关闭机制；它并不意味着每一项自动并行执行。消费者取消后仍需要保证资源清理。

## 5. 练习与答案

### 5.1 创建生成器时，为什么没有打印 start？

答案：生成器体尚未开始执行；第一次推进迭代时才进入。参数表达式等创建前动作仍可能已经执行，不等于调用完全没有成本。

### 5.2 遍历一半就 break，文件一定立刻关闭吗？

答案：不能仅凭 `break` 保证生成器关闭。持有资源时应明确管理生成器/资源生命周期，必要时使用上下文管理或显式关闭。

### 5.3 用生成器替换列表后，排序就不占内存了吗？

答案：不是。排序必须访问全部待排序元素，通常仍会物化。惰性只改变产生与保存的时机，不消除算法所需状态。

## 6. 参考资料

- [迭代器与生成器教程](https://docs.python.org/3.14/tutorial/classes.html#iterators)
- [生成器方法](https://docs.python.org/3.14/reference/expressions.html#generator-iterator-methods)
- [itertools](https://docs.python.org/3.14/library/itertools.html)
