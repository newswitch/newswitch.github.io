---
title: "GIL、解释器构建与 CPU、I/O 并发"
sidebar_label: "03. GIL、解释器构建与 CPU、I/O 并发"
sidebar_position: 3
description: "区分常规 GIL 构建、free-threaded 构建、原生扩展与多进程，按实际执行层选择并发模型。"
tags: [Python, CPython, 工程实践]
---

# GIL、解释器构建与 CPU、I/O 并发

“Python 不能多线程”与“用了多线程一定能多核加速”都不准确。需要先确定解释器构建，再确认工作是在 Python 字节码、原生库、内核等待还是设备上执行。

## 1. 常规 GIL 构建

常规 CPython 中，GIL 约束同一解释器内 Python 执行的并行方式。许多阻塞 I/O 与部分原生计算会释放 GIL，因此线程仍能用于重叠等待或执行特定原生计算。

释放 GIL 与操作是否线程安全是两回事。原生库可能有自己的锁或线程池；Python 锁也仍需保护跨多个步骤的业务不变量。

## 2. 记录真实构建

```python title="runtime_gil.py"
import platform
import sys
import sysconfig

def main():
    print(platform.python_implementation())
    print("version:", ".".join(map(str, sys.version_info[:2])))
    print("gil:", sys._is_gil_enabled())
    print("free-threaded build:", bool(
        sysconfig.get_config_var("Py_GIL_DISABLED")))

if __name__ == "__main__":
    main()
```

常规 CPython 3.14 构建输出：

```text title="runtime_gil.out"
CPython
version: 3.14
gil: True
free-threaded build: False
```

`sys._is_gil_enabled` 是 CPython 相关诊断能力，不是所有 Python 实现都提供的通用接口。基准结果必须记录这个环境前提。

## 3. Free-threaded 不等于无锁

Python 3.14 的 free-threaded 支持允许选择无 GIL 的构建，但第三方扩展兼容性、运行时是否重新启用 GIL、对象共享与性能特征都需要核对。

内置容器的内部保护，不等于多个容器操作组成的业务事务原子执行。代码仍要设计锁、所有权或消息传递；free-threaded 会让过去被调度偶然掩盖的竞态更容易出现。

## 4. 按瓶颈选模型

| 工作 | 常见候选 | 必须核对 |
| --- | --- | --- |
| 大量网络等待 | asyncio 或有界线程 | 驱动、连接池、总 Deadline |
| 常规构建里的纯 Python CPU 计算 | 进程或其他受控执行方式 | 序列化、内存与启动成本 |
| NumPy 等原生计算 | 原生库并行/线程 | 是否释放 GIL、内部线程数 |
| GPU/NPU 推理 | 框架与设备执行流 | 主机调度、数据传输与同步 |
| free-threaded Python 计算 | 受测线程方案 | 扩展兼容、竞态、实际加速比 |

不能只看函数是不是 async，也不能只看机器 CPU 利用率。先测队列、执行与等待，再决定是否换并发模型。

## 5. 练习与答案

### 5.1 有 GIL，网络线程就完全没有意义吗？

答案：不是。等待 I/O 时可以重叠其他工作；仍需限制线程与连接资源。

### 5.2 换 free-threaded，就可以删除所有 Lock 吗？

答案：不能。业务共享状态仍需同步，容器内部安全不等于整个业务操作原子。

### 5.3 CPU 算法搬到进程池一定更快吗？

答案：不一定。任务粒度、序列化、启动与内存搬运可能抵消计算收益，需要端到端测量。

## 6. 参考资料

- [Free-threading HOWTO](https://docs.python.org/3.14/howto/free-threading-python.html)
- [C API 中的 GIL 与线程状态](https://docs.python.org/3.14/c-api/init.html#thread-state-and-the-global-interpreter-lock)
