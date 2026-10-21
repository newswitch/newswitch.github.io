---
title: "异常、异常链、with 与资源生命周期"
sidebar_label: "07. 异常、异常链、with 与资源生命周期"
sidebar_position: 7
description: "区分异常分类、传播、转换与清理，理解上下文管理和 ExitStack 如何管理资源边界。"
tags: [Python, 对象模型, 编程原理]
---

# 异常、异常链、with 与资源生命周期

异常表达某条执行路径没有按正常契约完成。可靠程序不仅要知道怎么捕获，还要知道该不该捕获、是否保留原始原因，以及失败时已经取得的资源怎样释放。

## 1. 三类不同责任

输入校验失败通常由边界转换成可理解的错误；依赖调用失败可能需要重试或降级；程序错误如不变量破坏则应暴露并修复。一个 `except Exception: return []` 会把这三类情况全部混成“没有结果”。

先捕获具体的预期异常。`BaseException` 还覆盖退出、中断等控制事件；异步取消也不能被当成普通失败吞掉。记录日志后再次 `raise` 可以保留当前异常传播，`raise NewError(...) from error` 可以明确建立原因链。

## 2. 完整示例

```python title="objects_resource.py"
from contextlib import contextmanager, ExitStack

@contextmanager
def resource(name):
    print("open", name)
    try:
        yield name
    finally:
        print("close", name)

def parse_count(text):
    try:
        return int(text)
    except ValueError as error:
        raise ValueError("invalid count") from error

def main():
    try:
        with ExitStack() as stack:
            stack.enter_context(resource("first"))
            stack.enter_context(resource("second"))
            parse_count("bad")
    except ValueError as error:
        print(error)
        print(type(error.__cause__).__name__)

if __name__ == "__main__":
    main()
```

```text title="objects_resource.out"
open first
open second
close second
close first
invalid count
ValueError
```

资源按相反顺序关闭。第二个资源获取失败时，已经登记的第一个资源也会清理；动态数量的资源因此适合 `ExitStack`。`with` 不是异常消失的语法，而是确定进入、退出与异常处理协议。

## 3. try、else、finally

`try` 中只放需要处理的风险操作，避免把无关代码的错误也捕获进来。`else` 在 try 正常结束时执行；`finally` 负责无论正常或异常都应尝试的清理。

`finally` 里新的异常可能覆盖原始异常；在 finally 中使用退出控制流也可能改变传播。在 Python 3.14，一些离开 finally 的 `return/break/continue` 会触发语法警告；不要用它们隐藏业务结果。

清理操作本身可能失败，应定义如何记录与继续处理。数据库提交、文件 fsync 等不能简单当成“怎么都成功的 close”。

## 4. 上下文管理器如何工作

同步协议使用 `__enter__` 与 `__exit__`，异步使用 `__aenter__` 与 `__aexit__`。`__exit__` 返回真值可以抑制异常，因此实现时必须明确是否真的处理了它。

`contextmanager` 装饰的生成器应恰好 yield 一次；yield 前获取资源，yield 后或 finally 清理。不要捕获异常后不重新抛出，使调用方误以为工作成功。

资源生命周期与对象生命周期不同。对象仍存活不意味着连接必须一直占用；对象被回收也不应作为关闭事务或文件的唯一保证。

## 5. 并发中的异常

多任务可能同时失败，`ExceptionGroup` 与 `except*` 用于按组处理。这与普通捕获一个异常不同；不能把“捕获到第一个失败”理解为其他任务已经完成清理。结构化并发的取消与等待应一起设计。

### 5.1 异步清理与取消顺序

AsyncExitStack 使用 `await stack.enter_async_context(resource())` 登记异步上下文。取得第一个连接后立即登记，再获取第二个；第二次获取失败，栈才知道要释放第一个。只在全部创建成功后一次性登记，会漏掉中途失败路径。

当受保护任务被取消，CancelledError 会从等待点进入 with 的退出路径。任务发送 cancel 与任务结束是两个事件：调用方应 await 任务，再验证连接归还、文件关闭和子任务退出。`test_deepening.py` 用 Event 保证资源已经打开，取消任务后断言异步 finally 已执行，不使用固定 sleep 猜测时序。

清理内部再次等待，也可能遇到第二次取消。真正必须完成的收尾要设置有限预算、明确所有者，并谨慎使用屏蔽取消；不能无界 shield 导致进程永远退出不了。退出栈保证调用清理协议，不保证远端服务在网络断开后一定接受了回滚。

## 6. 练习与答案

### 6.1 打印异常后返回空列表，为什么会误导调用方？

答案：它丢失了“执行失败”与“查询成功但无结果”的区别。应保留异常或返回明确的错误模型。

### 6.2 with 能自动回滚所有外部动作吗？

答案：不能。它调用资源协议；具体是否回滚由实现决定。已经发送的 HTTP 请求或已提交事务，不会因离开 with 自动撤销。

### 6.3 动态打开第三个资源失败，前两个怎么处理？

答案：把成功获取的资源立即登记到 ExitStack；后续获取失败或作用域退出时，按逆序清理已经登记的资源。

## 7. 参考资料

- [异常教程](https://docs.python.org/3.14/tutorial/errors.html)
- [contextlib](https://docs.python.org/3.14/library/contextlib.html)
- [异常组](https://docs.python.org/3.14/library/exceptions.html#exception-groups)
