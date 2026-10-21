---
title: "Python 学习路线：语言、运行时与工程实践"
sidebar_label: "00. Python 学习路线"
sidebar_position: 0
description: "从解释器、对象与引用开始，逐步学习 Python 对象模型、标准库、并发、CPython 运行时、测试与性能诊断。"
tags: [Python, CPython, 编程基础, 学习路线]
---

# Python 学习路线：语言、运行时与工程实践

Python 代码短，不代表运行机制简单。变量保存的是什么，函数为什么会修改外面的列表，导入模块为什么会执行代码，异步函数为什么仍然可能阻塞，这些问题决定了程序能否正确扩展。

学习主线分成六个专题：先掌握表达和数据，再理解对象协议、资源与并发，最后进入运行时和工程验证。Web 开发只选择 [FastAPI](../fastapi/00-FastAPI学习路线.md)，不同时引入多套 Web 框架。

## 1. 环境与示例约定

语言示例以常规 CPython 3.14 为基线，首批使用 3.14.8 验证。这里的“常规”指默认带 GIL 的构建，不把 free-threaded、实验性 JIT 或第三方解释器的行为混为一谈。基础语法大多也适用于 3.13，但解释器版本、错误文本和字节码不能据此保证完全相同。

安装时选择对应平台仍受支持的修订版本；不要为了复现一段基础代码降级到有已知安全问题的版本。第三方框架的支持范围和版本组合，会在涉及该框架的文章中分别说明。

语言示例位于源码仓库的 `examples/python/language-lab/`，对象、标准库、并发和运行时示例位于 `examples/python/advanced-lab/`。文章中的文件名与示例名对应，输出中只有明确标注为“示意”的路径、版本和进程信息需要按实际环境替换。

[示例源码](https://github.com/newswitch/newswitch.github.io/tree/main/examples/python)包含完整脚本和可安装的包项目；每个示例旁的输出可在独立进程复现，临时文件只在实验目录创建。

## 2. 语言与工具链

按以下顺序阅读。这十篇构成独立的入门单元，不需要先会 Java。

| 顺序 | 文章 | 要理解的问题 |
| --- | --- | --- |
| 1 | [程序如何运行](./01-language/01-Python程序解释器脚本模块与交互环境.md) | Python、CPython、代码对象、进程和入口有什么关系 |
| 2 | [安装、虚拟环境与 pip](./01-language/02-Python安装虚拟环境pip与解释器定位.md) | 执行和安装是不是同一个解释器，隔离了什么 |
| 3 | [变量、对象、引用与复制](./01-language/03-变量对象引用可变性与复制.md) | 赋值、修改、浅复制和深复制分别改变哪里 |
| 4 | [数字、布尔值与精度](./01-language/04-数字布尔运算类型转换与精度.md) | 输入转换、真值和数值精度怎样影响结果 |
| 5 | [字符串、Unicode 与 bytes](./01-language/05-字符串Unicode-bytes与编码.md) | 文本、码点、字节和可见字符为什么不能混用 |
| 6 | [条件、循环与 match](./01-language/06-条件循环match与控制流.md) | 分支、迭代、提前退出和模式匹配何时发生 |
| 7 | [List、Tuple、Dict 与 Set](./01-language/07-List-Tuple-Dict-Set使用与成本.md) | 数据关系、顺序、键和操作成本如何选择 |
| 8 | [函数与参数](./01-language/08-函数参数默认值返回值与调用.md) | 实参怎样绑定，默认对象何时创建 |
| 9 | [作用域与闭包](./01-language/09-作用域名称查找闭包与变量捕获.md) | 名称从哪里查找，捕获的值何时读取 |
| 10 | [模块与导入](./01-language/10-模块包导入路径与导入副作用.md) | 导入如何查找、执行和缓存模块 |

## 3. 对象模型：九篇

对象模型专题在语言基础上逐项展开：

1. [类、实例、构造、属性与方法](./02-object-model/01-类实例构造属性与方法.md)
2. [继承、组合、MRO 与 super](./02-object-model/02-继承组合MRO与super.md)
3. [特殊方法、相等性、哈希与数据模型](./02-object-model/03-特殊方法相等哈希与数据模型.md)
4. [property、描述符与属性访问](./02-object-model/04-property描述符与属性访问.md)
5. [装饰器、包装函数与执行时机](./02-object-model/05-装饰器包装函数与执行时机.md)
6. [迭代器、生成器、yield 与惰性计算](./02-object-model/06-迭代器生成器yield与惰性计算.md)
7. [异常、异常链、with 与资源生命周期](./02-object-model/07-异常异常链with与资源生命周期.md)
8. [dataclass、Enum、类型注解、泛型与 Protocol](./02-object-model/08-dataclass-Enum类型注解泛型与Protocol.md)
9. [类型检查、泛型与结构化接口](./02-object-model/09-类型检查泛型与结构化接口.md)

判断是否真正理解对象，不是背出特殊方法的名字，而是能解释：某个操作调用了哪个协议，状态由谁拥有，异常发生后资源由谁释放。

## 4. 标准库与 I/O：六篇

1. [pathlib、文件、临时目录与原子替换](./03-library-io/01-pathlib文件临时目录与原子替换.md)
2. [JSON、TOML、环境变量、配置与 Secret](./03-library-io/02-JSON-TOML环境变量配置与Secret.md)
3. [collections、itertools 与 functools](./03-library-io/03-collections-itertools与functools.md)
4. [时间点、时区、时间戳与耗时测量](./03-library-io/04-时间点时区时间戳与耗时测量.md)
5. [logging、上下文与诊断证据](./03-library-io/05-logging上下文与诊断证据.md)
6. [HTTP 连接复用、TLS、超时与重试](./03-library-io/06-HTTP连接复用TLS超时与重试.md)

这一组解决“程序如何接触外部世界”。编码正确不等于文件已经持久化；收到 HTTP 超时不等于对方没有执行；环境变量存在不等于配置已经通过校验。

## 5. 并发与异步：六篇

1. [线程、锁与共享状态](./04-concurrency/01-线程锁与共享状态.md)
2. [进程、进程池、序列化与 IPC](./04-concurrency/02-进程进程池序列化与IPC.md)
3. [Executor、Future、有界队列与背压](./04-concurrency/03-Executor-Future有界队列与背压.md)
4. [async、await、事件循环、Task 与 Future](./04-concurrency/04-async-await事件循环Task与Future.md)
5. [TaskGroup、超时、取消传播与清理](./04-concurrency/05-TaskGroup超时取消传播与清理.md)
6. [contextvars、线程切换与同步异步互操作](./04-concurrency/06-contextvars线程切换与同步异步互操作.md)

学习顺序是“工作由谁执行 → 状态由谁拥有 → 等待发生在哪里 → 过载怎样限制 → 取消怎样完成”。不要把 `async def` 当成自动提速的标记。

## 6. CPython 运行时：三篇

1. [源码、字节码、代码对象与执行帧](./05-runtime/01-源码字节码代码对象与执行帧.md)
2. [引用计数、循环 GC、弱引用与进程内存](./05-runtime/02-引用计数循环GC弱引用与进程内存.md)
3. [GIL、解释器构建与 CPU、I/O 并发](./05-runtime/03-GIL解释器构建与CPU-IO并发.md)

语言规范定义允许的行为，CPython 实现决定具体的数据结构和执行路径。实现细节必须带版本与构建前提，不能拿某个版本的字节码推导所有 Python 程序。

## 7. 工程实践：四篇

1. [pyproject、依赖锁定、构建与发布](./06-engineering/01-pyproject依赖锁定构建与发布.md)
2. [pytest、Fixture、Mock、契约与异步测试](./06-engineering/02-pytest-Fixture-Mock契约与异步测试.md)
3. [调试、CPU、内存与性能诊断](./06-engineering/03-调试CPU内存与性能诊断.md)
4. [从输入到文件持久化的任务工具](./06-engineering/04-从输入到文件持久化的任务工具.md)

先完成单进程任务工具，再接入 FastAPI。输入、规则与存储分别测试，随后再扩展异步接口、持久化任务与事件流，不把业务逻辑写进启动脚本。深化依赖统一记录在 `examples/fastapi/deepening.lock`，包括静态检查、异步数据库和遥测 SDK。

## 8. 与自动化系列、FastAPI 的关系

[Python 自动化系列](../../automation/python/00-Python自动化从零到精通学习路线.md)侧重 CLI、SSH、Kubernetes API、巡检和交付；本系列补足逐项展开的语言与运行时基础。已有自动化经验的读者可以按问题返回本系列查阅，不必机械地重读相似例子。

FastAPI 需要的前置知识是：对象与引用、函数参数、模块、异常、类型注解、上下文管理和异步任务。可以先学完语言基础，再阅读其 HTTP 入门；涉及数据库事务和异步取消时，应补完对应基础。

## 9. 阅读进度

本系列提供 38 篇 Python 技术文章，覆盖六个专题；[FastAPI 系列](../fastapi/00-FastAPI学习路线.md)提供 34 篇框架与综合实践文章。入门先运行、预测并修改示例；进阶重点完成描述符、类型正反检查、竞态与修复、取消清理和内存快照，再独立扩展任务工具。

每个阶段都应能解释输入、执行顺序、状态归属和失败结果。能够运行现成代码只是起点，还应在不复制答案的情况下实现新规则，并通过测试说明错误路径不会破坏旧状态。

## 10. 参考资料

- [Python 3.14 教程](https://docs.python.org/3.14/tutorial/)
- [Python 3.14 语言参考](https://docs.python.org/3.14/reference/)
- [Python 3.14 标准库](https://docs.python.org/3.14/library/)
- [Python 版本支持状态](https://devguide.python.org/versions/)
