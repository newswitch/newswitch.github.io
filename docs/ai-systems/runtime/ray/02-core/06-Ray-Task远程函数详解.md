---
title: "Ray Task 远程函数详解"
sidebar_label: "06. Ray Task 远程函数详解"
sidebar_position: 6
description: "掌握 Ray Task 的定义、提交、依赖、资源、返回值、异常、重试、超时、取消、嵌套任务和有界并发。"
tags: [Ray, Task, ObjectRef, 重试, 取消, 分布式计算]
---

# Ray Task 远程函数详解

Ray Task 是一次无状态远程函数调用。它适合输入输出明确、可以分片、可以安全重算的计算；不适合依赖 Worker
进程残留状态、需要长期连接或必须串行修改共享状态的逻辑，这些需求通常使用 Actor 或外部状态系统。

## 1. 从普通函数到远程函数

```python
import ray

ray.init()

@ray.remote(num_cpus=1)
def normalize(value: float) -> float:
    return value / 100.0

result_ref = normalize.remote(42.0)
result = ray.get(result_ref)
print(result)
```

三个对象不要混淆：

- `normalize`：Ray RemoteFunction；
- `normalize.remote(...)`：提交一次 Task；
- `result_ref`：代表未来结果的 ObjectRef。

`.remote()` 是异步提交，不意味着 Task 已获得资源或开始运行。真实状态可能是等待依赖、等待资源、运行、
完成、失败或取消。

## 2. 提交和等待分离

```python
refs = [normalize.remote(value) for value in range(100)]
results = ray.get(refs)
```

避免在提交循环中立即 `ray.get()`：

```python
# 每次提交后等待，通常退化为串行
results = [ray.get(normalize.remote(value)) for value in range(100)]
```

任务数量巨大时也不能一次全部提交。应使用 `ray.wait()`、生成器或上层数据执行器控制在途数量。

## 3. ObjectRef 依赖

把 ObjectRef 直接交给下游 Task：

```python
@ray.remote
def load(path: str) -> bytes:
    return open(path, "rb").read()

@ray.remote
def parse(payload: bytes) -> list[dict]:
    return decode(payload)

@ray.remote
def aggregate(rows: list[dict]) -> dict:
    return summarize(rows)

payload_ref = load.remote("input.bin")
rows_ref = parse.remote(payload_ref)
summary_ref = aggregate.remote(rows_ref)
summary = ray.get(summary_ref)
```

Ray 在输入可用后运行下游 Task。中间结果无需先进入 Driver。对于嵌套容器中的 ObjectRef，解析行为有明确
规则，目标版本和复杂对象结构应通过小实验确认。

## 4. 参数传递和大对象复用

普通参数需要序列化。多个 Task 复用同一大只读对象时，可以先 Put：

```python
model_config_ref = ray.put(model_config)
refs = [run_partition.remote(partition, model_config_ref) for partition in partitions]
```

注意：

- 不要对每个小标量调用 `ray.put()`；
- 不要在循环中重复 Put 相同大对象；
- 不要通过闭包捕获大量 ObjectRef 并长期 Pin；
- GPU Tensor、文件句柄和数据库连接有各自的序列化边界；
- 大模型权重更适合由 Actor 初始化并复用，而不是随 Task 参数传递。

## 5. 返回多个结果

远程函数可以声明固定数量的返回值：

```python
@ray.remote(num_returns=2)
def split(values: list[int]):
    midpoint = len(values) // 2
    return values[:midpoint], values[midpoint:]

left_ref, right_ref = split.remote([1, 2, 3, 4])
left, right = ray.get([left_ref, right_ref])
```

大量流式结果应评估动态返回或生成器能力，而不是一次返回巨型列表。相关接口随版本演进，必须核对目标版本。

## 6. 资源声明

```python
@ray.remote(
    num_cpus=2,
    num_gpus=1,
    memory=4 * 1024**3,
    resources={"encoder_slot": 1},
)
def encode(batch):
    ...
```

资源声明用于调度，不自动提供完整的 cgroup、NUMA、显存或磁盘隔离。CPU 线程数、容器 Limit、GPU 可见设备
和真实内存峰值仍需单独控制。

可在调用时覆盖选项：

```python
ref = encode.options(num_cpus=4, name="encode-large-batch").remote(batch)
```

任务名称应包含稳定的业务阶段或分片信息，但避免写入密钥和敏感数据。

## 7. 异常传播

```python
@ray.remote
def divide(left: int, right: int) -> float:
    return left / right

ref = divide.remote(1, 0)
try:
    ray.get(ref)
except ray.exceptions.RayTaskError as error:
    print(error)
```

业务异常在消费结果时传播。下游 Task 依赖失败对象时，也可能在获取参数阶段失败。日志中应保留原始异常、
Task ID、Worker、Node、输入分片标识和尝试次数。

不要捕获所有异常后返回空数据，这会让 Job 表面成功、结果悄悄缺失。若允许跳过坏数据，应输出结构化失败
记录并设置质量阈值。

## 8. 重试语义

```python
@ray.remote(max_retries=3)
def fetch_partition(partition_id: str):
    ...
```

系统故障和应用异常的重试条件并不完全相同，`retry_exceptions` 等选项也有版本边界。使用前执行：

```python
help(fetch_partition.options)
```

更重要的是应用语义：

```text
Ray重新执行Task
≠
业务操作只发生一次
```

如果 Task 写数据库、发送通知或发布对象，应使用幂等键、临时路径、条件写、事务或提交标记。即使调用者收到
失败，也不能断言远端副作用一定没有发生。

## 9. 超时与 `ray.wait()`

```python
ready, pending = ray.wait(refs, num_returns=10, timeout=5)
```

超时表示等待者在给定时间内没有拿到足够结果，不代表底层 Task 已停止。应用需要决定：

- 继续等待；
- 记录慢任务并降级；
- 取消剩余任务；
- 保留任务在后台完成；
- 终止整个 Job。

HTTP 请求超时、Ray 等待超时、业务 Deadline 和 Worker 函数内部超时应共用预算并清晰传播。

## 10. 取消 Task

```python
ray.cancel(result_ref, force=False, recursive=True)
```

取消 Pending Task 和正在执行的 Task 行为不同。普通 Python Task 在非强制取消时可能收到中断；强制取消会
终止 Worker。取消不是事务回滚，已经写出的文件、数据库记录或远端 API 调用需要业务补偿。

当前 Ray 不会自动重试已取消 Task。`recursive=True` 会尝试取消子任务，使用前要确认调用树，避免误伤共享工作。

## 11. 嵌套 Task

Task 可以提交子 Task：

```python
@ray.remote
def child(value: int) -> int:
    return value * value

@ray.remote
def parent(values: list[int]):
    refs = [child.remote(value) for value in values]
    return ray.get(refs)
```

风险包括：

- 父 Task 占用 CPU，同时等待需要 CPU 的子 Task，形成资源等待；
- 每个父 Task 无限扇出，制造任务风暴；
- 取消和异常传播变复杂；
- 父 Task 返回前聚合大量结果导致 Heap 峰值。

优先让 Driver 或明确的协调 Actor 管理扇出；确需嵌套时，设计资源预留和最大并发。

## 12. Task 粒度

Task 太小：调度、序列化和对象元数据占主导。Task 太大：并行度不足、长尾严重，失败后重算成本过高。

通过实验选择粒度：

| 指标 | 需要观察的现象 |
| --- | --- |
| Task 执行时间 | 是否远大于提交和调度开销 |
| 在途 Task 数 | 是否持续积压 |
| 对象数量/大小 | 是否产生大量碎片对象 |
| Worker 利用率 | 是否频繁空闲或上下文切换 |
| P50/P99 | 是否被少数大分片拖慢 |
| 失败重算成本 | 单个分片是否过大 |

## 13. 常见反模式

- 循环内立即 `ray.get()`；
- 一次创建无界 Task；
- Task 依赖通用 Worker 上一次留下的全局状态；
- 每个 Task 重复加载大模型或创建昂贵连接；
- 把大对象拉回 Driver 再传给下游；
- 给所有异常设置无限重试；
- 用 `force=True` 取消代替协作式退出；
- 只看 CPU/GPU 利用率，不看 Pending 原因和对象依赖。

## 14. 验收实验

实现一个有界文件处理流水线：

1. 每个 Task 处理一个批次，而不是一个字节或整个数据集；
2. 最大在途 Task 数可配置；
3. 每个分片有稳定 ID；
4. 写出使用临时对象加原子发布；
5. 注入一次可重试系统故障和一次不可重试数据错误；
6. 记录完成、失败、取消、重试和最终数据量；
7. 验证重复运行不会产生重复业务结果。

## 15. 掌握标准

- 能解释提交、等待、依赖和结果传播；
- 能为 Task 选择合适粒度与资源；
- 能使用 `ray.wait()` 控制在途数量；
- 能区分超时、取消、失败和重试；
- 能为有副作用的 Task 设计幂等与提交协议；
- 能识别嵌套 Task 的资源等待风险。

下一篇：[Ray Actor 状态服务与生命周期](./07-Ray-Actor状态服务与生命周期.md)。

## 16. 官方资料 {/* #官方资料 */}

- [Ray Tasks](https://docs.ray.io/en/latest/ray-core/tasks.html)
- [Task Fault Tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/tasks.html)
- [ray.wait](https://docs.ray.io/en/latest/ray-core/api/doc/ray.wait.html)
- [ray.cancel](https://docs.ray.io/en/latest/ray-core/api/doc/ray.cancel.html)
- [Ray Design Patterns](https://docs.ray.io/en/latest/ray-core/patterns/index.html)
