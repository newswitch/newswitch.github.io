---
title: "dataclass、Enum、类型注解、泛型与 Protocol"
sidebar_label: "08. dataclass、Enum、类型注解、泛型与 Protocol"
sidebar_position: 8
description: "把数据记录、有限状态与结构化接口分开建模，理解静态类型与运行时校验的不同责任。"
tags: [Python, 对象模型, 编程原理]
---

# dataclass、Enum、类型注解、泛型与 Protocol

类型注解帮助表达“允许怎样使用一个值”，dataclass 生成常见记录行为，Enum 表达有限状态，Protocol 描述结构化接口。它们相互配合，但没有一个可以替代业务校验。

## 1. 四项能力各自负责什么

| 工具 | 主要职责 | 不会自动做到 |
| --- | --- | --- |
| dataclass | 生成初始化、表示与比较等方法 | 深层不可变、输入类型校验 |
| Enum | 定义具名的有限值集合 | 自动验证全部状态迁移 |
| 类型注解/泛型 | 表达参数、返回值与类型关系 | 自动在普通调用中强制校验 |
| Protocol | 描述满足哪些属性和方法 | 证明实现的业务语义正确 |

把接口里的金额写成 `float`、把所有异常写成 `None`，即使类型检查通过，也可能是错误的数据模型。类型正确首先需要契约正确。

## 2. 完整示例

```python title="objects_typing.py"
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

class State(StrEnum):
    READY = "ready"
    DONE = "done"

@dataclass(frozen=True)
class Job:
    name: str
    state: State = State.READY

@dataclass
class Batch:
    jobs: list[Job] = field(default_factory=list)

class Store(Protocol):
    def save(self, job: Job) -> str: ...

class MemoryStore:
    def save(self, job: Job) -> str:
        return f"{job.name}:{job.state.value}"

def persist(store: Store, job: Job) -> str:
    return store.save(job)

def main():
    first, second = Batch(), Batch()
    first.jobs.append(Job("import"))
    print(persist(MemoryStore(), first.jobs[0]))
    print(len(first.jobs), len(second.jobs))
    print(Job("import") == Job("import"))

if __name__ == "__main__":
    main()
```

```text title="objects_typing.out"
import:ready
1 0
True
```

`default_factory` 为每个实例创建列表；`frozen=True` 限制正常属性赋值，但不是深层冻结。MemoryStore 不必继承 Protocol，静态工具可按其方法结构检查兼容性。

## 3. 注解如何阅读

`list[Job]` 表示元素为 Job 的列表；`Job | None` 表示可能缺失；`Callable` 表达可调用契约；`TypeVar` 或现代类型参数语法表达输入输出之间的类型关系。

例如 `def first[T](items: list[T]) -> T` 表达返回元素类型与输入一致，但空列表仍可能失败。泛型不自动解决非空约束，也不能把所有运行状态都塞进类型名。

`Any` 会放宽检查，`object` 则表示任意对象但不允许不加判断就调用任意方法。大量使用 Any 可能让代码看起来“没有类型错误”，实际只是绕过了检查。

## 4. 静态与运行时

运行 `Job(123)` 不会因为注解自动拒绝整数；可在 `__post_init__` 中校验不变量，或在外部输入处使用明确的验证库。外部字典也不能因为被标注成 TypedDict 就获得运行时校验。

`runtime_checkable` 的 Protocol 检查主要看结构，不能据此证明方法参数类型和业务效果；不应把它当成安全授权检查。

Python 3.14 的注解支持延迟求值。直接读取内部注解属性、使用 `get_type_hints` 或 `annotationlib` 可能触发不同求值行为；运行时解析不可信注解也存在执行代码的风险。框架反射应遵循受信任代码与明确版本边界。

## 5. 选型顺序

本篇用于区分这些工具的职责；泛型、结构化接口和正反静态检查在[类型检查、泛型与结构化接口](./09-类型检查泛型与结构化接口.md)独立展开。先能解释为何 dataclass 不验证输入，再动手运行检查器，不需要一次记住全部 typing 名称。

先用普通函数和基本容器表达简单规则；字段具有稳定含义后使用记录类型；需要多个可替换实现时定义小接口；只有真实存在类型关系时才引入泛型。不要把所有字段都抽象成复杂类型层级。

## 6. 练习与答案

### 6.1 frozen 的记录包含列表时，列表一定不能改吗？

答案：不一定。冻结通常限制属性重新赋值，不递归冻结引用对象。应使用合适的不可变结构或约定复制边界。

### 6.2 Protocol 必须让实现类显式继承吗？

答案：通常不必，结构化类型检查关注是否满足接口。显式继承可以表达意图，但不能替代方法语义与测试。

### 6.3 类型检查通过，是否可以跳过 HTTP 输入校验？

答案：不可以。静态检查分析受控源码；外部请求在运行时到达，仍需要验证形态、范围、权限和业务约束。

## 7. 参考资料

- [dataclasses](https://docs.python.org/3.14/library/dataclasses.html)
- [Enum](https://docs.python.org/3.14/library/enum.html)
- [typing](https://docs.python.org/3.14/library/typing.html)
- [annotationlib](https://docs.python.org/3.14/library/annotationlib.html)
