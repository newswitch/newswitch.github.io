---
title: "继承、组合、MRO 与 super"
sidebar_label: "02. 继承、组合、MRO 与 super"
sidebar_position: 2
description: "沿方法解析顺序理解 super 的协作式调用，区分继承复用与对象组合。"
tags: [Python, 对象模型, 编程原理]
---

# 继承、组合、MRO 与 super

继承表达“可以按同一契约替代”，组合表达“把一项能力交给另一个对象”。仅为了少写几行代码而继承，会把初始化顺序、内部状态和子类耦合在一起。

## 1. MRO 决定查找顺序

读取对象方法时，Python 按类的方法解析顺序 MRO 查找。多继承使用 C3 线性化，既保留局部先后关系，也保持一致性；某些互相矛盾的继承顺序会在创建类时失败。

`super()` 不是“调用父类”的固定跳转。它在当前 MRO 中，从指定类之后继续查找，因此同一段基类代码，在不同的最终类型里可能走向不同的下一站。

## 2. 协作式多继承示例

```python title="objects_mro.py"
class A:
    def run(self):
        return ["A"]

class B(A):
    def run(self):
        return ["B"] + super().run()

class C(A):
    def run(self):
        return ["C"] + super().run()

class D(B, C):
    def run(self):
        return ["D"] + super().run()

def main():
    value = D()
    print(" -> ".join(cls.__name__ for cls in D.__mro__))
    print(value.run())

if __name__ == "__main__":
    main()
```

```text title="objects_mro.out"
D -> B -> C -> A -> object
['D', 'B', 'C', 'A']
```

`B.run` 的下一站是 `C.run`，不是它声明中的 `A`。如果改为显式调用 `A.run(self)`，就绕过了 MRO 中的 `C`；若多个分支都显式调用公共祖先，还可能重复初始化或重复执行操作。

## 3. 协作调用需要共同契约

链上的方法需要兼容签名，并约定是否继续 `super`；初始化链还需要约定参数的消费与传递。把所有参数无条件丢给 `object.__init__` 不会自动成功。

不要把 `super` 与“所有基类一定都会运行”画等号：某层不继续调用，链就到那里为止。应画出实际的 `__mro__` 和调用点，而不是凭继承图猜顺序。

## 4. 什么时候使用组合

假设任务服务需要把结果写入数据库或文件，与其让服务继承两个存储类，更清晰的方式是让它持有一个 `repository`，调用 `repository.save(result)`。测试时替换成内存实现，业务服务不需要知道连接池与文件句柄。

| 需要表达的关系 | 优先考虑 |
| --- | --- |
| 子类型保持相同输入、输出与失败契约 | 继承或结构化接口 |
| 可替换的外部能力 | 组合与依赖注入 |
| 少量正交行为，且调用顺序清晰 | 谨慎使用 Mixin |
| 仅共享几个工具函数 | 普通函数或独立模块 |

继承后的覆盖方法不能悄悄把输入限制得更严格，或把约定的返回结果换成完全不同含义。能够调用同名方法，不代表能够在业务上互相替换。

## 5. 诊断顺序

先查看 `type(obj).__mro__`，再确认实际调用的是哪个方法；检查方法是否调用 `super`、有无装饰器改变行为，以及类属性是否被实例属性遮蔽。不要在未看清链路前继续叠加 Mixin。

## 6. 练习与答案

### 6.1 B 的直接基类是 A，为什么 super 会进入 C？

答案：`super` 遵循最终实例类型的 MRO。D 的顺序是 D、B、C、A，因此在 B 后查找会先进入 C。

### 6.2 每个类都显式调用 A 初始化更保险吗？

答案：不是。菱形继承可能重复调用公共祖先，也会绕过协作链。应统一初始化契约，或改用组合减少隐式顺序。

### 6.3 更换数据库实现，必须改服务的父类吗？

答案：通常不必。服务依赖存储接口，持有一个实现对象即可。替换能力与类型继承应分开设计。

## 7. 参考资料

- [super](https://docs.python.org/3.14/library/functions.html#super)
- [MRO HOWTO](https://docs.python.org/3.14/howto/mro.html)
