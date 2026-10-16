---
title: "Python 线程、进程、asyncio 与有界并发"
sidebar_label: "07. 线程、进程与 asyncio"
sidebar_position: 7
description: "根据 I/O 与 CPU 负载选择线程、进程或 asyncio，设计有界队列、取消、背压、结果收敛和部分失败。"
tags: [Python, Thread, Process, asyncio, Concurrency]
---

# Python 线程、进程、asyncio 与有界并发

并发的目标不是“同时启动更多任务”，而是在不压垮本机和下游的前提下缩短完成时间。必须同时限制活动任务数、排队量、连接池、结果内存和重试流量。

## 1. 选择模型

| 模型 | 适合 | 主要风险 |
| --- | --- | --- |
| 顺序 | 少量任务、调试、严格顺序 | 总耗时长 |
| 线程池 | 阻塞型 HTTP、SSH、文件 I/O | 共享状态、线程安全、无法强制停止调用 |
| 进程池 | 可分割 CPU 密集任务 | 序列化、启动成本、内存、子进程清理 |
| asyncio | 大量支持异步协议的 I/O | 阻塞事件循环、取消和任务泄漏 |

CPython 的线程通常不能让纯 Python CPU 计算线性加速，但 I/O 等待时仍有价值。具体行为还受解释器实现和扩展库释放 GIL 的方式影响。

## 2. 线程池

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def run_checks(targets: list[str], workers: int) -> list[tuple[str, object]]:
    results: list[tuple[str, object]] = []
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="probe") as executor:
        futures = {executor.submit(check_one, target): target for target in targets}
        for future in as_completed(futures):
            target = futures[future]
            try:
                results.append((target, future.result()))
            except Exception as exc:
                results.append((target, exc))
    return results
```

该写法一次提交全部目标，目标极多时 Future 本身会占用内存。生产实现要分批提交或使用有界队列。

共享 HTTP/SSH 客户端是否线程安全必须查阅具体库契约。不要凭经验假设。

## 3. asyncio 与 TaskGroup

```python
import asyncio

async def bounded_check(target: str, semaphore: asyncio.Semaphore):
    async with semaphore:
        async with asyncio.timeout(10):
            return await check_one_async(target)

async def run_all(targets: list[str], concurrency: int):
    semaphore = asyncio.Semaphore(concurrency)
    tasks: dict[str, asyncio.Task[object]] = {}
    async with asyncio.TaskGroup() as group:
        for target in targets:
            tasks[target] = group.create_task(bounded_check(target, semaphore))
    return {target: task.result() for target, task in tasks.items()}
```

`TaskGroup` 采用结构化并发，成员异常会影响同组任务。是否 Fail Fast 或收集全部结果应按业务设计，不能让默认行为替你决定。

不要在事件循环直接调用阻塞库。可使用真正异步客户端，或在受控线程中桥接阻塞调用。

## 4. 进程池

进程任务和参数需要可序列化，入口必须防止子进程重复执行主逻辑：

```python
def main() -> int:
    return run_cpu_jobs()

if __name__ == "__main__":
    raise SystemExit(main())
```

容器 CPU Quota、NUMA、内存和启动方式都会影响进程池。先基准测试，不把 `os.cpu_count()` 直接当最佳 Worker 数。

## 5. 背压

背压意味着生产者不能无限快地产生任务：

```text
有限输入分页
→ 有界队列
→ 固定 Worker
→ 有界结果聚合
→ 下游速率限制
```

如果队列已满，可以阻塞生产者、拒绝新任务或降级采样，但必须明确记录，不能静默丢失。

## 6. 取消和 Deadline

取消步骤：

1. 停止创建新任务。
2. 请求尚未开始的任务取消。
3. 通知活动任务停止。
4. 等待有限宽限期。
5. 保存已完成和未完成状态。
6. 清理连接、临时文件和锁。

线程中的阻塞系统调用通常不能被 Python 强制安全终止，因此底层客户端自己的 Timeout 非常重要。

## 7. 结果收敛

每个目标使用结构化结果：

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class TaskResult:
    target: str
    state: str
    attempts: int
    duration_seconds: float
    error_type: str | None = None
```

最终状态至少区分全部成功、部分成功、全部失败、取消和任务状态未知。

## 8. 限流与重试放大

若 20 个 Worker 每个立即重试 3 次，故障时会瞬间产生更多流量。重试应共享全局限流预算，并采用抖动。

并发、连接池和下游配额需要一起配置：

```text
Worker 数 ≤ 客户端连接池 ≤ 下游允许并发
```

## 9. 验收

- [ ] 并发数和队列长度都有上限。
- [ ] 所有外部调用有 Timeout。
- [ ] 所有 Future/Task 都被等待或取消。
- [ ] 一个任务失败不会丢失其他结果。
- [ ] 中断后没有继续写入的后台任务。
- [ ] 并发和重试没有超过下游配额。
- [ ] 使用目标规模和故障比例做过压测。
