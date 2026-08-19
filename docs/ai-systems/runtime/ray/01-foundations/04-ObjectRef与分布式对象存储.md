---
title: "ObjectRef 与分布式对象存储"
sidebar_label: "04. ObjectRef 与分布式对象存储"
sidebar_position: 4
description: "理解 ObjectRef、对象所有权、分布式引用计数、共享内存、序列化、对象传输、Spill、重建与对象内存故障。"
tags: [Ray, ObjectRef, Object Store, Plasma, Spill, 内存]
---

# ObjectRef 与分布式对象存储

Ray 的 Task 和 Actor 并不是靠普通 Python 变量跨进程共享数据。远程调用返回 `ObjectRef`，实际对象由 Ray
管理并存放在集群对象体系中。理解引用、所有权、共享内存和 Spill，是避免 Driver OOM、Object Store Full
和跨节点传输瓶颈的基础。

## 1. ObjectRef 是什么

```python
import ray

ray.init()

@ray.remote
def build_batch() -> list[int]:
    return [1, 2, 3]

batch_ref = build_batch.remote()
print(type(batch_ref))
print(ray.get(batch_ref))
```

`batch_ref` 是远程对象引用，不是结果本身。它可以：

- 交给 `ray.get()` 解析；
- 作为另一个 Task 或 Actor Method 的参数；
- 放入列表、字典等容器；
- 被 `ray.wait()` 用于有界等待；
- 在引用仍有效时保持对应对象的分布式生命周期。

不要依赖 ObjectRef 的字符串表示作为业务 ID，也不要把它永久存入外部数据库后假设跨集群、跨重启仍可用。

## 2. `ray.put()`、Task 返回值和内联参数

### 2.1 `ray.put()` {/* #ray-put */}

```python
large_config = {"weights": [1, 2, 3]}
config_ref = ray.put(large_config)
```

`ray.put()` 把本地值交给 Ray 对象体系，适合多个下游任务复用同一份较大只读输入。不要把每个很小的标量都
手工 `ray.put()`，也不要在循环里反复 Put 相同大对象。

### 2.2 Task 返回值 {/* #task返回值 */}

```python
@ray.remote
def load_partition(path: str):
    return read_partition(path)

partition_ref = load_partition.remote("part-0001")
```

返回值由 Ray 管理。下游 Task 接收引用时，Ray 可以根据位置和依赖关系安排对象获取。

### 2.3 普通参数 {/* #普通参数 */}

调用远程函数时，普通 Python 参数需要序列化。大对象频繁按值传递可能导致重复序列化或复制。应通过性能分析
确认对象大小、复用次数和节点位置，而不是机械地把所有参数改成 ObjectRef。

## 3. 不要过早 `ray.get()`

错误模式：

```python
raw = ray.get(load.remote())
cleaned = ray.get(clean.remote(raw))
features = ray.get(featurize.remote(cleaned))
```

这会让 Driver 成为每一步的同步点和数据中转站。更合适的方式：

```python
raw_ref = load.remote()
cleaned_ref = clean.remote(raw_ref)
features_ref = featurize.remote(cleaned_ref)
features = ray.get(features_ref)
```

依赖通过 ObjectRef 传播，下游任务只有在输入可用后才能运行，Driver 可以继续提交其他工作。

## 4. 每节点对象存储

Ray 在每个 Node 上运行对象存储。对象可能位于一个或多个节点：

```text
Node A
├─ Worker A1创建对象X
└─ Object Store保存X

Node B
├─ Worker B1需要X
└─ Ray按需把X传输或恢复到Node B
```

这不等于所有对象都自动复制到所有节点。对象位置、消费者位置、引用关系和恢复能力共同决定传输行为。

Linux 上对象存储通常使用共享内存区域。容器中的 `/dev/shm` 过小会严重影响可用容量或性能，因此 Docker
和 Kubernetes 部署必须显式核对共享内存，而不是只看容器 Memory Limit。

## 5. 序列化与零拷贝边界

不同进程没有同一个 Python Heap，参数和返回值通常要序列化。Ray 使用 Pickle 5/cloudpickle 体系处理许多
Python 对象，并使用对象存储传输数据。

对某些 NumPy 数组，同一节点读取对象存储中的数据可以利用共享内存和零拷贝反序列化。由对象存储映射得到的
数组可能是只读的；如果业务需要修改，应显式复制：

```python
mutable = numpy_array.copy()
```

“零拷贝”不代表：

- 跨节点不走网络；
- 任意 Python 对象都零拷贝；
- GPU Tensor 自动在不同 GPU 间零成本共享；
- 对象没有引用计数和元数据开销。

应针对实际数据类型和路径做 Profile。

## 6. 对象所有权与引用计数

Ray 使用分布式引用计数管理对象生命周期。只要集群中仍存在有效引用，对象可能被 Pin：

- Driver 或 Worker 的本地 Python 变量持有 ObjectRef；
- Pending Task 的参数包含 ObjectRef；
- 某个对象内部序列化了另一个 ObjectRef；
- Actor 状态保存了 ObjectRef。

因此下面的现象并不矛盾：业务代码“已经不用结果了”，但对象仍未释放。需要找出仍然持有引用的 Owner、
Task、Actor 或容器对象。

可以检查：

```bash
ray summary objects
ray memory --group-by=STACK_TRACE --sort-by=OBJECT_SIZE
```

对象引用创建位置的记录可能需要在集群启动时启用，并带来额外开销。只能在评估后用于目标环境。

## 7. `ray.wait()` 与有界并发

一次提交百万个 Task，即使每个 Task 很小，也会制造大量元数据、ObjectRef 和 Pending 工作。使用
`ray.wait()` 控制在途任务：

```python
import ray

@ray.remote
def process(item: int) -> int:
    return item * 2

max_in_flight = 32
pending = []
results = []

for item in range(1000):
    pending.append(process.remote(item))
    if len(pending) >= max_in_flight:
        ready, pending = ray.wait(pending, num_returns=1)
        results.extend(ray.get(ready))

while pending:
    ready, pending = ray.wait(pending, num_returns=1)
    results.extend(ray.get(ready))
```

`max_in_flight` 必须通过任务耗时、对象大小、Worker 数量和下游吞吐压测决定。它不是越大越好。

## 8. Object Spilling

当对象存储空间不足时，Ray 可以把可 Spill 的对象写到磁盘或配置的外部存储路径，再在需要时恢复。

```text
Object Store接近上限
→ 选择可Spill对象
→ 写入Spill目录
→ 释放共享内存空间
→ 消费者需要时Restore
```

Spill 是容量缓冲，不是免费内存：

- 磁盘吞吐不足会拖慢整个流水线；
- Spill 与 Restore 会增加 I/O 和延迟；
- 目录容量不足会把内存压力转成磁盘故障；
- 网络文件系统可能带来共享故障和放大流量；
- Kubernetes Pod 使用临时盘时要考虑 `ephemeral-storage`、驱逐和生命周期。

生产环境应记录对象存储容量、Spill 路径、磁盘类型、容量、告警阈值和清理边界。

## 9. 对象丢失与重建

如果保存对象的 Node 失败，对象是否可恢复取决于来源、所有者和任务谱系等条件。由可重试 Task 生成的对象
可能通过重新执行恢复；`ray.put()` 对象、外部副作用和不可重算数据的恢复边界不同。

不要把 Ray Object Store 当持久存储。必须长期保留的模型、数据集、Checkpoint 和业务结果应写入明确的
持久介质，并具有校验、版本和提交协议。

## 10. 常见反模式

### 10.1 Driver 拉取所有中间结果 {/* #driver拉取所有中间结果 */}

后果：Driver Heap OOM、网络汇聚、流水线串行化。让下游 Task 直接消费 ObjectRef。

### 10.2 重复传递同一个大对象 {/* #重复传递同一个大对象 */}

后果：重复序列化、传输和存储。评估一次 `ray.put()` 后复用引用，或把只读状态放入 Actor。

### 10.3 返回极多微小对象 {/* #返回极多微小对象 */}

后果：元数据和调度开销占主导。批量化任务和返回值。

### 10.4 Actor 永久保存引用 {/* #actor永久保存引用 */}

后果：对象被长期 Pin，Spill 和内存压力持续。设计有界缓存、过期和显式状态清理。

### 10.5 把 Spill 当数据库 {/* #把spill当数据库 */}

后果：Pod、节点或目录清理后数据消失。需要持久语义的数据写到对象存储、数据库或共享文件系统。

## 11. 内存问题要分层

| 内存层 | 典型内容 | 主要证据 |
| --- | --- | --- |
| Driver Heap | Driver 的 Python 对象、解析后的结果 | 进程 RSS、Heap Profile |
| Worker Heap | Task/Actor 的 Python 对象和库内存 | Worker PID、RSS、异常日志 |
| Object Store | Task 返回值、`ray.put()` 对象 | `ray summary objects`、Object Store 指标 |
| Shared Mapping | Worker 映射的共享对象 | RSS 与 SHR，避免重复计算 |
| GPU Memory | 权重、KV Cache、激活和通信 Buffer | `nvidia-smi`、框架显存指标 |
| Spill Storage | 被写出的对象 | 磁盘容量、吞吐、Spill/Restore 指标 |

不能看到进程 RSS 很大就直接认定 Python Heap 泄漏；共享内存映射可能被多个进程显示。也不能把 CUDA OOM
归因于 Object Store，二者位于不同内存层。

## 12. 排障流程

```text
对象内存持续增长？
→ 哪类对象增长、由谁创建？
→ 是否仍有ObjectRef被Driver/Actor/Pending Task持有？
→ 是Worker Heap还是Object Store？
→ Spill是否发生、目录是否健康？
→ 对象是否过大、过碎或重复传输？
→ 限流、批量、释放引用或改变数据路径
```

不要一上来只扩大对象存储。若根因是无限提交或引用泄漏，更大的容量只会延迟故障。

## 13. 实验建议

设计三组可重复实验：

1. 相同大数组作为普通参数重复传递，与 `ray.put()` 后复用 ObjectRef 对比；
2. 在循环内立即 `ray.get()`，与先提交/有界 `ray.wait()` 对比；
3. 调小实验 Object Store 并产生大对象，观察 Spill、磁盘和延迟变化。

每组保存 Task 数、对象数量与大小、Worker/Driver RSS、Object Store 使用量、Spill 字节、耗时和磁盘吞吐。

## 14. 掌握标准

- 能区分 Python 值、ObjectRef 和实际远程对象；
- 能解释每节点 Object Store、跨节点传输和共享内存边界；
- 能使用 `ray.wait()` 建立有界并发；
- 能区分 Worker Heap、Object Store、Shared Mapping、GPU 显存和 Spill；
- 知道 Ray Object Store 不是持久存储；
- 能从引用持有者和对象增长证据定位内存问题。

下一篇：[资源调度与 Placement Group](./05-资源调度与Placement-Group.md)。

## 15. 官方资料 {/* #官方资料 */}

- [Ray Objects](https://docs.ray.io/en/latest/ray-core/objects.html)
- [Memory Management](https://docs.ray.io/en/latest/ray-core/scheduling/memory-management.html)
- [Serialization](https://docs.ray.io/en/latest/ray-core/objects/serialization.html)
- [Object Spilling](https://docs.ray.io/en/latest/ray-core/objects/object-spilling.html)
- [Ray Design Patterns and Anti-patterns](https://docs.ray.io/en/latest/ray-core/patterns/index.html)
