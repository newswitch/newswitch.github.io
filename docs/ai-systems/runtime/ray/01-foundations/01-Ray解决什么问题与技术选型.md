---
title: "Ray 解决什么问题与技术选型"
sidebar_label: "01. Ray 解决什么问题与技术选型"
sidebar_position: 1
description: "理解 Ray 的定位、核心抽象和适用边界，并与 multiprocessing、Celery、Spark、Dask、Kubernetes、Slurm 和推理引擎进行职责对比。"
tags: [Ray, 分布式计算, 技术选型, Task, Actor, AI Infra]
---

# Ray 解决什么问题与技术选型

Ray 解决的核心问题是：让开发者用接近普通 Python 的方式，把有依赖关系的计算和有状态服务分布到
多个进程、多张 GPU 和多台机器，同时由统一运行时处理资源调度、对象传输和部分故障恢复。

它不是 Kubernetes 的替代品，也不是 vLLM、PyTorch 或 Spark 的同义词。生产系统常见的组合是：

```text
Kubernetes：提供机器、Pod、网络、存储和声明式生命周期
Ray：提供应用内部的分布式 Task、Actor、对象和逻辑资源调度
Ray Serve：提供长期在线服务、Replica、路由与扩缩容
vLLM / SGLang：执行大模型推理
NCCL：完成 GPU 集合通信
```

## 1. 从一个单机程序开始

假设程序需要并行处理一批文件：

```python
def transform(path: str) -> dict:
    ...

results = [transform(path) for path in paths]
```

单机可以用线程池或进程池。如果数据量增加到多台机器，代码还要处理：

- Worker 在哪里启动；
- 每个任务需要多少 CPU、GPU 和内存；
- 参数和结果怎样跨进程、跨节点传输；
- 某个 Worker 或节点退出后哪些任务需要重试；
- 如何限制并发，避免把任务队列和内存撑满；
- 如何观察 Pending、Running、Failed 和资源占用；
- 如何部署和升级整个集群。

Ray 把其中一部分通用机制收敛到运行时，但应用仍需负责数据正确性、幂等、外部副作用和业务级恢复。

## 2. Ray 的五个基础抽象

### 2.1 Task：无状态远程计算 {/* #task无状态远程计算 */}

普通函数加上 `@ray.remote` 后成为远程函数，调用 `.remote()` 会异步提交 Task：

```python
import ray

ray.init()

@ray.remote(num_cpus=1)
def square(value: int) -> int:
    return value * value

refs = [square.remote(value) for value in range(4)]
print(ray.get(refs))
```

Task 适合无状态、输入输出清晰、失败后能够安全重算的工作。

### 2.2 Actor：有状态远程服务 {/* #actor有状态远程服务 */}

类加上 `@ray.remote` 后成为 Actor 类。Actor 实例拥有独立进程和可变状态：

```python
@ray.remote
class Counter:
    def __init__(self):
        self.value = 0

    def increment(self) -> int:
        self.value += 1
        return self.value

counter = Counter.remote()
print(ray.get(counter.increment.remote()))
```

Actor 适合模型副本、状态缓存、连接池、协调器和需要复用昂贵初始化结果的对象。若工作不需要状态，
优先使用 Task，以获得更灵活的调度和 Worker 复用。

### 2.3 ObjectRef：远程对象引用 {/* #objectref远程对象引用 */}

`.remote()` 通常立即返回 `ObjectRef`，而不是直接返回结果。引用可以作为下游 Task 的参数，Ray 会建立
依赖关系，在对象就绪后再运行下游任务。

不要在每次提交后立刻 `ray.get()`：

```python
# 串行化了提交与等待
results = [ray.get(square.remote(value)) for value in range(4)]

# 先提交，再统一等待
refs = [square.remote(value) for value in range(4)]
results = ray.get(refs)
```

### 2.4 Resource：逻辑资源请求 {/* #resource逻辑资源请求 */}

Task 和 Actor 可以声明 CPU、GPU、内存与自定义资源。Ray 用逻辑资源做准入和放置：

```python
@ray.remote(num_cpus=2, num_gpus=1, resources={"encoder": 1})
def encode(batch):
    ...
```

逻辑资源不是完整隔离机制。`num_cpus=1` 不会自动建立 Linux CPU quota；应用进程仍可能创建额外线程，
容器层面的 cgroup、CPU Manager 和 GPU 分配仍由底层平台负责。

### 2.5 Placement Group：成组预留资源 {/* #placement-group成组预留资源 */}

分布式训练和多卡推理经常要求多个 Worker 同时获得资源。Placement Group 把多个 Bundle 原子预留，
并用 PACK、SPREAD、STRICT_PACK 或 STRICT_SPREAD 表达放置关系。

它解决的是 Ray 层的 Gang Scheduling；在 Kubernetes 中，Pod 能否创建和 GPU 能否分配仍要经过 Kubernetes
调度。两层资源声明不一致时，可能出现 Pod 已运行但 Ray Task 永久 Pending，或 Ray 认为有 GPU 但容器
看不到设备。

## 3. Ray 的分层位置

```text
业务 API / 训练入口 / 数据任务
               │
Ray Data / Train / Tune / Serve / Serve LLM
               │
Task / Actor / Object / Resource / Placement Group
               │
Ray Driver / Worker / Raylet / GCS / Object Store
               │
进程、容器、节点、网络、磁盘、CPU、GPU
               │
裸机 / 虚拟机 / Kubernetes / 云资源
```

上层库并没有绕开 Ray Core。一次 Ray Serve Replica 调度、一组 Ray Train Worker 或一组 vLLM Engine Worker，
最终仍会落到 Actor、资源和 Placement Group。因此遇到 Pending、对象丢失或节点退出时，需要回到 Core
对象排查。

## 4. Ray 适合哪些工作负载

### 4.1 动态 Python 任务图 {/* #动态-python-任务图 */}

任务数量和依赖关系在运行期间生成，无法轻易提前写成固定 DAG；任务粒度足够大，调度开销占比可控。

### 4.2 有状态并行服务 {/* #有状态并行服务 */}

例如模型副本、仿真环境、参数服务器、特征服务或需要长时间保留状态的 Worker。Actor 能将状态与进程
生命周期绑定，并声明资源和恢复策略。

### 4.3 分布式 AI 工作负载 {/* #分布式-ai-工作负载 */}

- 数据预处理与批量推理；
- 多 Worker 分布式训练；
- 超参数搜索；
- 在线模型服务；
- 多 GPU、多节点大模型推理。

### 4.4 CPU 与 GPU 混合流水线 {/* #cpu与gpu混合流水线 */}

Tokenizer、数据读取和预处理使用 CPU，模型使用 GPU，后处理和写出再使用 CPU。Ray 可以分别声明资源，
但仍要通过基准测试确定 Batch、对象大小、并发和节点拓扑。

## 5. 哪些场景不应优先使用 Ray

### 5.1 单机任务已经足够 {/* #单机任务已经足够 */}

任务只需一个进程池，数据没有跨节点需求，且部署简单比弹性更重要。此时 `multiprocessing`、
`concurrent.futures` 或 `asyncio` 通常更直接。

### 5.2 大量极短小任务 {/* #大量极短小任务 */}

如果每个任务只执行极短时间，序列化和调度开销可能超过计算本身。应先批量化或在单个 Task 内部处理
一组元素，再判断是否需要分布式。

### 5.3 强事务消息处理 {/* #强事务消息处理 */}

需要持久消息、严格消费确认、跨服务解耦和长期积压时，Kafka、RabbitMQ 等消息系统通常更符合问题模型。
Ray 的内存对象和任务依赖不能替代业务事件日志。

### 5.4 纯 SQL 与成熟大数据流水线 {/* #纯sql与成熟大数据流水线 */}

主要工作是大规模 SQL、结构化 ETL，且组织已经有成熟 Spark 生态时，不应只因 Python API 更短就迁移。
应比较数据规模、Shuffle、容错、治理、Connector、团队经验和运维成本。

### 5.5 只需要启动一个模型进程 {/* #只需要启动一个模型进程 */}

单节点、单模型、固定副本的 vLLM 服务可以直接运行或由 Kubernetes 管理。引入 Ray 会增加控制面、端口、
版本和排障复杂度。只有当多节点模型实例、复杂副本放置、模型组合或 Ray 生态能力带来明确收益时再引入。

## 6. 常见技术对比

| 技术 | 主要职责 | 状态模型 | 典型场景 | 与 Ray 的关系 |
| --- | --- | --- | --- | --- |
| `multiprocessing` | 单机多进程 | 本机进程 | 单机 CPU 并行 | Ray 可扩展到多节点，但复杂度更高 |
| `asyncio` | 单进程异步 I/O | 协程 | 高并发网络 I/O | 可在 Ray Actor 内组合使用 |
| Celery | 分布式任务队列 | Broker + Result Backend | 后台任务、消息驱动 | 更强调持久队列；Ray 更强调计算图和资源 |
| Spark | 分布式数据计算 | Dataset/DataFrame | SQL、ETL、Shuffle | 与 Ray Data 部分重叠，生态和执行模型不同 |
| Dask | Python 并行计算 | Task Graph | 数组、DataFrame、科学计算 | 与 Ray Core/Data 有重叠，按生态和工作负载选择 |
| Kubernetes | 容器编排 | 声明式资源对象 | 集群基础设施与应用生命周期 | KubeRay 在 Kubernetes 上管理 Ray |
| Slurm | HPC 作业与资源调度 | Batch Job | 超算、批处理训练 | 可以先由 Slurm 分配节点，再在作业内启动 Ray |
| vLLM | LLM 推理引擎 | Engine / Worker | 高吞吐生成服务 | 可由 Ray/Serve 编排多节点 Worker 和副本 |

## 7. 选型时必须回答的问题

### 7.1 工作单元是什么 {/* #工作单元是什么 */}

- 无状态函数还是有状态服务？
- 单个任务执行多久？
- 参数和结果多大？
- 任务是否能重试？
- 是否会写数据库、对象存储或调用外部 API？

### 7.2 资源需求是什么 {/* #资源需求是什么 */}

- CPU、GPU 和内存比例是否固定？
- 需要同机多卡还是跨节点？
- Worker 必须同时启动吗？
- 是否需要指定 GPU 型号、机架或网络域？

### 7.3 数据怎样移动 {/* #数据怎样移动 */}

- 大对象是否被重复传输？
- 数据能否在对象存储中复用？
- Object Store 满后写到哪里？
- 模型权重来自本地盘、共享文件系统还是对象存储？

### 7.4 失败意味着什么 {/* #失败意味着什么 */}

- Task 重算是否安全？
- Actor 重启后状态从哪里恢复？
- 节点失败会丢失哪些对象？
- 外部副作用是否具有幂等键和提交协议？

如果这些问题没有答案，把代码加上 `@ray.remote` 只会把单机问题放大到集群。

## 8. 大模型部署中的职责边界

以跨两台机器的 vLLM 推理为例：

| 层 | 负责内容 | 不负责内容 |
| --- | --- | --- |
| Kubernetes | Pod、GPU 设备、Service、PVC、节点生命周期 | vLLM 内部 Rank 计算和 Token 调度 |
| KubeRay | RayCluster、RayService、Head/Worker Pod | 模型算子与 NCCL 性能 |
| Ray | Actor、Placement Group、Worker 放置与状态 | CUDA Kernel 正确性和模型格式 |
| Ray Serve LLM | 模型服务配置、Replica、路由和扩缩 | 物理网络带宽保证 |
| vLLM | 模型加载、KV Cache、Batch、TP/PP 与生成 | Kubernetes 节点供应 |
| NCCL/RDMA | GPU 集合通信和数据传输 | 应用重试和 HTTP 路由 |

排障时应沿层次找第一个失败证据，不能把所有跨节点卡住都归因于 Ray，也不能用增加 Timeout 掩盖
某个 Rank 更早发生的 OOM 或模型加载错误。

## 9. 最小决策流程

```text
单机能满足容量和SLO？
├─ 是 → 先使用单机并发或单机模型服务
└─ 否
   ├─ 只是容器副本管理？ → Kubernetes Deployment / Job
   └─ 应用内部需要动态分布式执行？
      ├─ 数据SQL/ETL为主 → 比较 Spark / Ray Data
      ├─ 持久消息任务为主 → 比较消息队列 / Celery
      └─ Python Task/Actor、AI任务或多节点模型 → 评估 Ray
```

选用 Ray 后仍需先做单机基线，再逐步扩大到两节点和目标规模。没有单机正确性、资源和性能基线，
多机结果无法解释。

## 10. 掌握标准

完成本文后，应能够：

- 用一句话分别解释 Task、Actor、ObjectRef、Resource 和 Placement Group；
- 说明 Kubernetes、Ray、Ray Serve 和 vLLM 的职责边界；
- 判断一个需求是否值得引入 Ray；
- 为候选工作负载写出任务粒度、资源、数据传输和失败语义；
- 识别“为了分布式而分布式”的过度设计。

下一篇：[安装 Ray 并运行第一个分布式任务](./02-安装Ray并运行第一个分布式任务.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Ray Core Key Concepts](https://docs.ray.io/en/latest/ray-core/key-concepts.html)
- [Ray Core Walkthrough](https://docs.ray.io/en/latest/ray-core/walkthrough.html)
- [Ray Architecture](https://docs.ray.io/en/latest/ray-contribute/whitepaper.html)
- [Ray Serve LLM](https://docs.ray.io/en/latest/serve/llm/index.html)
