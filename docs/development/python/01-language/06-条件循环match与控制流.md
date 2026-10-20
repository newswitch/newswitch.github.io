---
title: "条件、循环、match 与控制流"
sidebar_label: "06. 条件、循环、match 与控制流"
sidebar_position: 6
description: "理解 Python 真值分支、迭代协议、range、循环 else、提前退出和结构化模式匹配，避免遍历修改与无限重试。"
tags: [Python, 控制流, 循环, match, 编程基础]
---

# 条件、循环、match 与控制流

控制流决定哪些语句执行、执行几次、何时停止。能写出一个 `for` 并不够：必须说明无匹配时怎样处理，异常会不会被误判成成功，循环是否有明确的停止条件。

## 1. 分支与缩进

`if/elif/else` 从上往下测试条件，执行第一个成立分支，后续分支不再执行。`else` 不需要条件；分支体通过缩进形成代码块。

```python
def classify(value):
    if value is None:
        return "missing"
    elif value < 0:
        return "negative"
    else:
        return "non-negative"
```

将缺失判断放在比较前，避免对 `None` 执行不允许的数值比较。这里约定其余输入是可比较数值；若是外部原始文本，还要先完成转换和范围校验。

`a if condition else b` 是条件表达式，会得到一个值，只计算被选中的一侧。不要为了压缩行数，把有副作用的多层分支写成难读的嵌套表达式。

## 2. for 遍历对象，不是固定的整数计数器

`for item in iterable` 从可迭代对象逐项取值。`range(start, stop, step)` 表达整数序列，终点不包含在内，且不会预先生成所有整数的列表。

需要索引用 `enumerate`，同时遍历多组数据用 `zip`。默认 `zip` 在最短输入结束时停止；如果长度不等意味着数据损坏，使用 `zip(..., strict=True)` 让不一致暴露为异常。

`while` 则反复检查条件。读取外部状态、重试等场景需要最大次数、总 Deadline 和失败出口；`while True` 本身没有提供这些边界。

## 3. 完整实验

```python title="control_demo.py"
def find_first(values, target):
    for index, value in enumerate(values):
        if value == target:
            break
    else:
        return "missing"
    return f"found:{index}"

def describe(event):
    match event:
        case {"kind": "start", "port": int(port)} if 1 <= port <= 65535:
            return f"start:{port}"
        case {"kind": "stop"}:
            return "stop"
        case _:
            return "invalid"

def main():
    print("range:", list(range(1, 6, 2)))
    print(find_first([4, 8, 9], 8))
    print(find_first([], 8))
    print(describe({"kind": "start", "port": 8000}))
    print(describe({"kind": "start", "port": 70000}))
    print("filtered:", [x * x for x in range(5) if x % 2 == 0])
    try:
        print(list(zip([1, 2], ["a"], strict=True)))
    except ValueError:
        print("zip: length mismatch")

if __name__ == "__main__":
    main()
```

```text title="control_demo.out"
range: [1, 3, 5]
found:1
missing
start:8000
invalid
filtered: [0, 4, 16]
zip: length mismatch
```

`find_first` 中 `break` 退出当前循环，再执行后面的 `return`；找不到目标时会执行循环的 `else`。空输入也属于正常耗尽，会进入 `else`。

## 4. break、continue、return 与循环 else

| 语句 | 改变哪里 |
| --- | --- |
| `break` | 退出最内层循环，不自动退出函数 |
| `continue` | 跳过当前轮剩余语句，进入下一轮 |
| `return` | 结束当前函数调用，可返回值 |
| `raise` | 抛出异常，沿异常处理规则传播 |
| `pass` | 不执行动作，不代表跳到下一轮 |

循环 `else` 不是“循环没有执行”。它表示循环正常耗尽/条件正常变假，没有通过 `break` 退出；函数 `return` 或异常直接离开时也不会继续运行这个 `else`。

嵌套循环中的 `break` 只影响当前层。如果需要跨层返回结果，通常抽取函数、明确返回值，比多层状态标志更清晰。

## 5. match 是结构匹配，不是普通 switch

示例按字典结构匹配，并通过 guard 检查端口范围。字典模式默认允许额外键，所以 `{"kind": "stop", "extra": 1}` 仍可匹配停止分支。

`int(port)` 在模式中是类型模式，不是把字符串转换成整数；字符串 `"8000"` 不会因此通过。`bool` 是 `int` 子类也会影响这类匹配，严格数据校验需要额外排除或交给明确的输入模型。

最容易误用的是裸名称：

```python
match status:
    case expected:
        print(expected)
```

这里 `expected` 是捕获模式，通常匹配任何值并绑定名称，不是与之前某个同名变量比较。匹配字面量使用 `case "ready"`；动态比较可以使用 guard，枚举常量则使用带限定名称的值模式。

模式变量的可见性也不同于某些语言的块级变量。不要依赖匹配失败后部分绑定的状态；只在成功分支内使用与该分支有关的捕获结果。

## 6. 遍历与修改

遍历列表时删除元素，索引移动可能使下一项被跳过；遍历字典时增删键可能触发 `RuntimeError`。不要一边遍历原容器一边改变它的结构，优先生成新结果：

```python
ports = [0, 80, 443, 0]
valid = [port for port in ports if port > 0]
print(valid)  # [80, 443]
```

推导式适合简单映射和筛选，不适合隐藏日志、网络调用和复杂异常处理。上面的完整实验最后也说明：严格长度检查可能在迭代到不一致处才失败，不保证在任何元素处理之前发现错误；有副作用的消费逻辑必须考虑部分完成。

## 7. 练习与答案

### 7.1 for 的输入为空，会执行 else 吗？

答案：会。循环没有通过 `break` 退出，而是正常耗尽。若业务要求“至少处理一项”，应另行检查，不能把循环 `else` 当成成功标志。

### 7.2 case expected 会比较之前定义的 expected 吗？

答案：不会，这是名称捕获模式。比较动态值可以使用 `case value if value == expected:`；此时还要避免捕获名与被比较名混淆。

### 7.3 zip strict 检查失败前，是否可能已消费部分输入？

答案：可能。`zip` 是惰性迭代，在发现长度不一致时才报错。若处理每对元素会写数据库，要设计事务、幂等或先验证输入，不能把严格检查当成整体原子性保证。

## 8. 参考资料

- [控制流教程](https://docs.python.org/3.14/tutorial/controlflow.html)
- [复合语句：循环与 match](https://docs.python.org/3.14/reference/compound_stmts.html)
- [内置函数：enumerate 与 zip](https://docs.python.org/3.14/library/functions.html)
