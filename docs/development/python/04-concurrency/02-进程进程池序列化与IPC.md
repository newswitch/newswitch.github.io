---
title: "进程、进程池、序列化与 IPC"
sidebar_label: "02. 进程、进程池、序列化与 IPC"
sidebar_position: 2
description: "理解进程隔离、启动方式、可序列化任务与数据搬运成本，建立可靠的多进程入口。"
tags: [Python, 并发, asyncio]
---

# 进程、进程池、序列化与 IPC

进程拥有独立地址空间，可以隔离部分状态并利用多个 CPU 核，但提交任务需要搬运代码引用与数据。把线程池改成进程池，不是零成本获得加速。

## 1. 创建与数据流

父进程提交任务，任务与参数通过序列化/IPC 到达子进程，子进程计算后再发送结果。普通 Python 列表不会因为创建了进程池就成为所有进程可共同修改的列表。

`spawn` 启动新解释器，要求可导入入口；`fork` 复制进程状态但在多线程等环境有额外风险；`forkserver` 通过专门服务创建。Python 3.14 调整了部分平台默认方式，文章示例显式选择 spawn，避免依赖平台默认。

## 2. 完整示例

```python title="concurrency_processes.py"
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context

def square(value):
    return value * value

def main():
    with ProcessPoolExecutor(max_workers=2,
                             mp_context=get_context("spawn")) as pool:
        results = list(pool.map(square, range(4), chunksize=1))
    print(results)

if __name__ == "__main__":
    main()
```

```text title="concurrency_processes.out"
[0, 1, 4, 9]
```

目标函数放在模块顶层；入口保护避免子进程导入时再次创建池。交互环境中的临时函数、lambda、闭包不适合直接假设能被 spawn 子进程加载。

## 3. 序列化的成本与边界

传送大数组、模型权重和复杂对象，可能让序列化与复制比计算还贵。共享内存可以减少部分复制，但需要定义布局、同步、生命周期与清理；它不等于自动共享所有 Python 对象。

不要反序列化不可信 pickle。进程池参数也不能随意包括正在使用的连接、锁和框架会话。子进程通常应在自己的生命周期中创建相应资源。

## 4. 故障与退出

子进程异常通常经 Future 传回；异常退出可能破坏池，未完成任务不能直接假设已经回滚。进程被强制终止可能遗留外部写入、锁或临时文件。

Context manager 默认会等待工作结束；给 `future.result` 设置超时，不表示退出池时就不再等待。长期任务要有工作级 Deadline、可中断边界和必要的隔离。

## 5. 练习与答案

### 5.1 子进程修改参数里的列表，父进程一定看到吗？

答案：不会自动看到，普通任务参数经过序列化传递。需要显式返回结果或使用明确共享机制。

### 5.2 为什么必须保护进程池入口？

答案：spawn 会重新导入入口模块。若导入时又创建进程池，会递归启动或触发启动阶段错误。

### 5.3 大模型权重能每个任务传一遍吗？

答案：通常成本很高。应设计工作进程初始化、只传任务元数据，或使用受控共享/外部存储，具体取决于框架与硬件限制。

## 6. 参考资料

- [multiprocessing](https://docs.python.org/3.14/library/multiprocessing.html)
- [ProcessPoolExecutor](https://docs.python.org/3.14/library/concurrent.futures.html#processpoolexecutor)
- [shared_memory](https://docs.python.org/3.14/library/multiprocessing.shared_memory.html)
