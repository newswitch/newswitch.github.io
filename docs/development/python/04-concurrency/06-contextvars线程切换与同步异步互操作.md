---
title: "contextvars、线程切换与同步异步互操作"
sidebar_label: "06. contextvars、线程切换与同步异步互操作"
sidebar_position: 6
description: "理解上下文快照、Task 创建与线程卸载的传播方向，避免请求身份跨并发工作泄露。"
tags: [Python, 并发, asyncio]
---

# contextvars、线程切换与同步异步互操作

请求 ID、租户身份等信息需要跟随逻辑执行流，而不是保存在一个进程全局变量里。contextvars 为不同上下文提供名称绑定，但不把共享对象自动变成线程安全。

## 1. 上下文属于谁

Task 创建时通常复制当前上下文；后续父任务修改绑定，不会自动改掉已经创建的子任务上下文。`to_thread` 会传播适当的当前上下文到线程，但线程里的重新绑定通常不会反向修改调用方上下文。

不同 API 的传播规则不一样。手动创建线程、使用 run_in_executor 或第三方执行器时，应查具体接口与构建行为，不要凭“都在线程里”推导相同语义。

## 2. 完整实验

```python title="concurrency_context.py"
import asyncio
from contextvars import ContextVar

request_id = ContextVar("request_id", default="none")

async def read_after(gate):
    await gate.wait()
    return request_id.get()

def in_thread():
    before = request_id.get()
    request_id.set("thread")
    return before

async def main():
    token = request_id.set("first")
    try:
        gate = asyncio.Event()
        task = asyncio.create_task(read_after(gate))
        request_id.set("second")
        gate.set()
        print(await task)
        print(await asyncio.to_thread(in_thread))
        print(request_id.get())
    finally:
        request_id.reset(token)
    print(request_id.get())

if __name__ == "__main__":
    asyncio.run(main())
```

```text title="concurrency_context.out"
first
second
second
none
```

子任务保留创建时的绑定 first；线程观察到卸载时的 second；线程改为 thread 不会回写父任务；token 负责恢复之前上下文，而不是随意设置一个默认字符串。

## 3. 保存引用不等于复制对象

如果 ContextVar 的值是一个列表，上下文复制后仍可能引用同一个列表。建议请求身份等上下文使用不可变或受控记录，避免原地修改共享状态。

ContextVar 通常定义在模块层，而不是每个请求动态创建大量新的变量。上下文可能保留变量引用，应考虑长期任务与回调生命周期。

## 4. 同步异步边界

异步函数不能直接安全调用任意阻塞代码；同步函数也不能随意在已经运行的事件循环里嵌套 asyncio.run。跨线程提交到事件循环应使用对应线程安全入口，并设置等待与关闭规则。

取消等待 to_thread 的结果，通常不会立刻终止里面的同步函数。因此阻塞库自身仍需超时；连接池和线程池上限也需要协调。

## 5. 练习与答案

### 5.1 子任务为什么读到 first 而不是 second？

答案：它创建时复制了当时上下文绑定。读取发生得更晚，不等于重新读取父任务当前上下文。

### 5.2 上下文复制后，列表就不会共享了吗？

答案：不会自动深复制。两个上下文可以保存相同可变对象引用，原地修改仍可能互相影响。

### 5.3 取消 to_thread 的 await 能强杀线程吗？

答案：通常不能。工作可能继续运行，需要同步函数自身的超时、停止信号和资源边界。

## 6. 参考资料

- [contextvars](https://docs.python.org/3.14/library/contextvars.html)
- [to_thread 与线程互操作](https://docs.python.org/3.14/library/asyncio-task.html#running-in-threads)
