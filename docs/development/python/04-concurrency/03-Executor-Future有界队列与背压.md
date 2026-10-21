---
title: "Executor、Future、有界队列与背压"
sidebar_label: "03. Executor、Future、有界队列与背压"
sidebar_position: 3
description: "区分提交、运行、完成与取消，限制任务积压并解释超时为何不等于工作停止。"
tags: [Python, 并发, asyncio]
---

# Executor、Future、有界队列与背压

线程池或进程池管理执行资源，Future 表达一次工作的结果状态。限制 Worker 数量，只限制同时运行的任务，不一定限制已经提交的任务与输入内存。

## 1. 状态与等待

Future 可能处于等待、运行、已完成或已取消等状态。`result(timeout=...)` 只限制调用方等多久；运行中的任务通常不能靠 `cancel` 自动停止。

失败需要从结果通道观察，不能提交后不再读取。遇到一个失败时，其余任务是否继续、如何收尾，也必须有明确策略。

## 2. 有界提交示例

```python title="concurrency_futures.py"
from concurrent.futures import Future, ThreadPoolExecutor

def square(value):
    return value * value

def main():
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(square, range(5), buffersize=2))
    print(result)
    pending = Future()
    print(pending.cancel(), pending.cancelled())
    try:
        pending.result()
    except Exception as error:
        print(type(error).__name__)

if __name__ == "__main__":
    main()
```

```text title="concurrency_futures.out"
[0, 1, 4, 9, 16]
True True
CancelledError
```

`buffersize` 是 Python 3.14 的 map 能力，用于限制尚未被消费结果的提交窗口。示例中的手工 Future 只演示状态，不代表能取消已经运行的线程。

## 3. 顺序与吞吐

`map` 按输入顺序产生结果；前面的慢任务可能挡住后面已完成任务的消费。`as_completed` 按完成情况观察，但使用它之前若一次 submit 一百万个任务，积压已经形成。

更可靠的模式是维护一个有限窗口：完成一个再补一个，并限制结果缓存。输入文件、任务队列、连接池和输出写入都需要协调，而不是只调整 max_workers。

## 4. 背压的含义

当下游处理不过来，上游应等待、拒绝或降低速率，而不是无限排队。队列满时的策略是接口契约的一部分：等待要有 Deadline，拒绝要有可解释错误，丢弃必须只用于允许丢失的工作。

避免在同一个小线程池的任务里同步等待该池其他任务，可能形成所有 Worker 都在等待、没人能执行被等任务的死锁。

### 4.1 从一个窗口追到整条链路

假设输入是一百万条、每项可能返回一兆字节。四个 Worker 不意味着只有四兆内存：输入预先物化、已提交 Future、完成但未消费的结果、下游写入缓冲都可能同时占用。需要逐段写出上限，而不是只圈出 max_workers。

当前 map 示例的 buffersize 限制尚未交付结果的提交窗口，适合按输入顺序消费。若任务耗时差异大，用 wait(..., return_when=FIRST_COMPLETED) 维护有限 Future 集合：补满窗口 → 等至少一项完成 → 处理结果与异常 → 再补缺口。每次提交前先确认总 Deadline 和退出信号。

如果输出写入变慢，应让结果消费反过来降低输入读取速度。给每一层各加一个大队列只会让排队时间隐藏得更深；长度、字节数和年龄都值得观测。决定拒绝时，应返回稳定错误并让调用方有界退避，避免所有调用者立即同时重试。

Future.result 超时后仍然运行的线程必须由调用者继续观察，或交给明确的持有者收尾。不要把 Future 引用丢掉，然后再次提交相同外部写操作。取消等待与取消执行，在[结构化并发](./05-TaskGroup超时取消传播与清理.md)中继续分析。

## 5. 练习与答案

### 5.1 两个 Worker 是否保证最多只保存两个任务？

答案：不保证。submit 队列与输入、输出缓存可能更大，需要额外限制提交窗口。

### 5.2 Future 超时后，能马上重试写请求吗？

答案：不能只凭等待超时判断。原工作可能仍在执行，重试可能重复写入，需要工作级取消和幂等协议。

### 5.3 as_completed 自动提供背压吗？

答案：不会。它主要改变观察完成的方式；若此前已提交全部任务，资源已经积压。

## 6. 参考资料

- [concurrent.futures](https://docs.python.org/3.14/library/concurrent.futures.html)
- [Queue 的阻塞与完成协议](https://docs.python.org/3.14/library/queue.html)
