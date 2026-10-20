---
title: "property、描述符与属性访问"
sidebar_label: "04. property、描述符与属性访问"
sidebar_position: 4
description: "从数据描述符与非数据描述符理解属性校验、方法绑定及属性查找顺序。"
tags: [Python, 对象模型, 编程原理]
---

# property、描述符与属性访问

属性访问不一定是读取实例字典。`property`、实例方法、ORM 字段等都可能通过描述符参与查找。理解这一层，就能解释“没有在实例里保存的方法为什么能绑定 self”。

## 1. 描述符是什么

对象的类型实现 `__get__`、`__set__` 或 `__delete__` 等描述符方法后，把该对象放在另一个类的属性中，就能参与后者的属性访问。

在常规 `object.__getattribute__` 行为下，简化的读取优先级是：数据描述符、实例字典、非数据描述符或普通类属性；继承关系中的类属性查找还受 MRO 影响。`__getattr__` 只在常规查找失败后参与，不是每次访问都先调用。

数据描述符具有设置/删除方面的协议，非数据描述符只有读取协议。普通函数作为非数据描述符提供方法绑定；`property` 是常见的数据描述符。

## 2. property 校验示例

```python title="objects_property.py"
class Endpoint:
    def __init__(self, port):
        self.port = port

    @property
    def port(self):
        return self._port

    @port.setter
    def port(self, value):
        if type(value) is not int or not 1 <= value <= 65535:
            raise ValueError("invalid port")
        self._port = value

def main():
    endpoint = Endpoint(8000)
    print(endpoint.port)
    endpoint.port = 9000
    print(endpoint.port)
    endpoint.__dict__["port"] = -1
    print(endpoint.port)
    try:
        endpoint.port = True
    except ValueError as error:
        print(error)

if __name__ == "__main__":
    main()
```

```text title="objects_property.out"
8000
9000
9000
invalid port
```

向实例字典强行塞入 `port`，仍没有遮蔽数据描述符。真正状态存放在 `_port`；这不是说任何代码都无法破坏状态，而是正常属性赋值被统一引导到校验入口。

## 3. 只读与缓存

没有 setter 的 property 对正常赋值是只读，但它的 getter 可以返回可变对象，调用方仍可能修改其内部。只读接口、不可变对象和授权边界并不等价。

`functools.cached_property` 首次计算后通常把结果放进实例字典，后续读取使用缓存；它与普通 property 的存储和覆盖语义不同，也要求相应实例支持该存储方式。并发首次访问的计算次数，不应被当成业务“恰好一次”的保证。

## 4. 自定义描述符时需要处理的情况

`__get__(self, instance, owner)` 要区分类访问与实例访问，类访问时 `instance` 可为 `None`。`__set_name__` 可以在类创建阶段获取属性名，避免所有字段错误地共用同一个存储键。

描述符对象本身常由所有实例共享，因此不能把每个实例的值直接存在 `descriptor.value` 中，否则会串数据。应按实例存储或使用明确的外部映射。

覆盖 `__getattribute__` 时，读取内部属性也可能再次触发自己，造成递归。通常先使用 property/描述符；确有需要时通过 `object.__getattribute__` 等正确委托，并保留协议行为。

## 5. 练习与答案

### 5.1 只有 getter 的 property 能保证深层不可变吗？

答案：不能。它只能控制属性替换入口；返回列表后，调用方仍可修改列表。要定义真正的只读数据契约，需要考虑返回对象与复制策略。

### 5.2 描述符里存一个 value，为什么不同实例可能互相覆盖？

答案：类属性中的描述符对象通常共享。每实例状态必须按实例区分存储，不能混在描述符自身的单一字段里。

### 5.3 getattr 与 getattribute 一样吗？

答案：不一样。`__getattribute__` 参与正常读取；`__getattr__` 在常规查找失败后兜底。误用前者更容易绕过描述符或造成递归。

## 6. 参考资料

- [描述符指南](https://docs.python.org/3.14/howto/descriptor.html)
- [property](https://docs.python.org/3.14/library/functions.html#property)
- [cached_property](https://docs.python.org/3.14/library/functools.html#functools.cached_property)
