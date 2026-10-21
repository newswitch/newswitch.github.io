---
title: "TaskGroup、超时、取消传播与清理"
sidebar_label: "05. TaskGroup、超时、取消传播与清理"
sidebar_position: 5
description: "通过结构化并发理解子任务失败、兄弟取消、异常组和清理，区分停止等待与真正停止工作。"
tags: [Python, 并发, asyncio]
---

# TaskGroup、超时、取消传播与清理

取消是一次请求，不是瞬间抹掉执行。任务通常在可响应的等待点收到取消异常，之后还需要执行清理。只关心“超时异常已返回”，会遗漏后台仍在运行的工作。

## 1. 结构化并发

TaskGroup 将一组任务约束在共同作用域内：离开作用域前观察它们的完成；某个任务发生非取消失败时，会处理兄弟任务取消与等待，再以异常组等方式传播失败。

与随手创建后台任务相比，父作用域拥有子任务生命周期，资源与错误更容易收敛。不能将其误认为数据库事务：已经发生的外部写入不会自动回滚。

## 2. 失败后等待清理

```python title="concurrency_cancel.py"
import asyncio

async def wait_forever(started, cleaned):
    started.set()
    try:
        await asyncio.Event().wait()
    finally:
        cleaned.set()

async def fail_after(started):
    await started.wait()
    raise RuntimeError("broken")

async def main():
    started, cleaned = asyncio.Event(), asyncio.Event()
    try:
        async with asyncio.TaskGroup() as group:
            group.create_task(wait_forever(started, cleaned))
            group.create_task(fail_after(started))
    except* RuntimeError:
        print("failure observed")
    print("cleanup:", cleaned.is_set())
    try:
        async with asyncio.timeout(0.01):
            await asyncio.Event().wait()
    except TimeoutError:
        print("timeout")

if __name__ == "__main__":
    asyncio.run(main())
```

```text title="concurrency_cancel.out"
failure observed
cleanup: True
timeout
```

Event 保证待取消任务已经进入受 finally 保护的执行路径。TaskGroup 退出后才检查清理结果，而不是发送 cancel 后立刻假设资源已释放。

## 3. 取消传播

捕获 `asyncio.CancelledError` 时通常在完成必要清理后重新抛出，不要当成普通业务异常吞掉。它继承 BaseException，宽泛的退出控制可能破坏 TaskGroup、timeout 等机制。

`shield` 保护等待对象不直接受当前等待者取消影响，不等于工作永远安全完成。仍需保存任务引用、观察结果并明确退出时如何处理。

线程中的阻塞调用与远端请求也未必能被 asyncio 取消中断。取消 Python 等待，并不证明远程操作已经撤销。

## 4. 超时预算

`asyncio.timeout` 控制作用域内的等待，超时处理通常在作用域外捕获 TimeoutError。清理本身可能消耗额外时间，不能把超时值当成精确的墙上时间上限。

重试必须共享总预算，并给清理与响应留空间。超时后还要区分可重试读取、未知提交结果和明确失败。

### 4.1 把总预算分配到多次尝试

一个请求总预算一秒，如果依赖每次超时九百毫秒、重试三次，就不能声称仍受一秒保护。使用单调时钟计算绝对 Deadline，每次尝试只使用剩余预算，并为回滚、连接清理和响应留出空间；次数上限与总预算应同时存在。

取消请求通常会沿当前等待链传播，但线程函数与远端服务有独立生命。数据库提交响应超时，可能是提交失败，也可能是提交完成但响应未返回；应查询幂等记录，而不是因为捕获 TimeoutError 就重复扣款。

TaskGroup 遇到普通失败会等待组内清理。清理里也可能抛错，最终 ExceptionGroup 可含多个原因；except* 只处理匹配部分，未处理部分继续传播。不要把日志里第一条异常自动当成全部问题，也不要用捕获 BaseException 清空整个失败组。

配套 test_deepening.py 在 Event 指示资源已打开之后发出取消，await 结束再验证 cleaned。综合任务 Worker 进一步把“执行工作”和“租约续期”放进同一 TaskGroup，任一失败都需要另一项收尾，而非留下无人管理的续租协程。

## 5. 练习与答案

### 5.1 cancel 调用返回，就能复用任务持有的连接吗？

答案：不行。需等待任务真正结束并完成清理，或按资源协议确认连接仍可用。

### 5.2 TaskGroup 会撤销失败前已提交的数据库事务吗？

答案：不会。它管理任务生命周期，外部一致性需要事务、幂等或补偿设计。

### 5.3 为什么不吞掉 CancelledError 后继续无限循环？

答案：这可能阻止父作用域退出，破坏超时和结构化并发。取消通常应在清理后继续传播。

## 6. 参考资料

- [TaskGroup、timeout 与取消](https://docs.python.org/3.14/library/asyncio-task.html)
- [asyncio 异常](https://docs.python.org/3.14/library/asyncio-exceptions.html)
