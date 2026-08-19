---
title: "Job、Driver、Task、Actor、Worker 与 Node"
sidebar_label: "03. Job、Driver、Task、Actor、Worker 与 Node"
sidebar_position: 3
description: "建立 Ray 运行对象、进程和节点的完整映射，理解 Driver 提交、Worker 执行、Actor 状态、Raylet 调度与 GCS 元数据职责。"
tags: [Ray, Job, Driver, Task, Actor, Worker, Raylet, GCS]
---

# Job、Driver、Task、Actor、Worker 与 Node

Ray 排障最常见的困难不是命令不会用，而是把不同层级的对象混在一起：Task 失败不等于 Worker 节点退出，
Actor 死亡不等于 Job 结束，Kubernetes Pod Running 也不等于 Ray Node Alive。

先建立统一映射：

```text
用户提交入口
└─ Job
   ├─ Driver：运行用户入口代码并提交工作
   ├─ Task：一次无状态远程函数调用
   │  └─ Worker进程执行
   └─ Actor：有身份和状态的远程类实例
      └─ 专属Worker进程执行Actor方法

Ray Cluster
├─ Head Node
│  ├─ GCS及集群控制组件
│  ├─ Raylet
│  ├─ Object Store
│  └─ Worker进程
└─ Worker Node
   ├─ Raylet
   ├─ Object Store
   └─ Worker进程
```

## 1. Cluster 与 Node

Ray Cluster 是一组加入同一控制面的 Ray Node。每个 Node 通常对应一台主机或一个容器化 Pod，而不是一张
GPU，也不是一个 Task。

每个 Node 上的重要组件包括：

- **Raylet**：节点代理，参与资源管理、Worker 管理、调度和对象传输协调；
- **Object Store**：节点级共享内存对象存储；
- **Worker Process**：执行 Task 或承载 Actor；
- 日志、运行目录和监控组件。

Head Node 还承担集群控制面职责。生产环境不应把“Head”理解成所有业务数据必经的主节点，也不应把大量
业务计算固定到 Head。Head 故障影响集群控制面，Worker 节点故障影响该节点上的进程和对象，两者故障域不同。

查看节点：

```bash
ray list nodes --format table
ray status
```

在 Kubernetes 中还要同时检查：

```bash
kubectl get rayclusters
kubectl get pods -o wide
kubectl get nodes
```

## 2. Job

Job 是一组由同一入口发起的 Ray 工作。入口可以是：

- 直接运行一个调用 `ray.init()` 的 Python 脚本；
- 连接已有集群的 Driver；
- 通过 Ray Jobs API/CLI 提交的命令；
- 由 RayJob 等上层对象创建的提交过程。

Job 是观察和归属边界，但不是强事务。Job 失败不保证外部数据库写入回滚，也不保证所有独立生命周期的
Detached Actor 自动删除。

查看 Job：

```bash
ray list jobs --format table
ray job list --address http://<dashboard-host>:8265
```

State CLI 和 Jobs CLI 使用的服务入口可能不同，目标地址以对应子命令帮助为准。

## 3. Driver

Driver 是运行用户入口代码的进程。它负责：

- 初始化或连接 Ray；
- 定义/导入远程函数和 Actor 类；
- 提交 Task、创建 Actor；
- 保存 ObjectRef 和 Actor Handle；
- 等待结果、处理异常并决定应用退出码。

Driver 不应成为所有大对象的中转站。下面的模式会把每个结果先拉回 Driver：

```python
loaded = ray.get(load.remote())
transformed = ray.get(transform.remote(loaded))
saved = ray.get(save.remote(transformed))
```

更合适的依赖传递是：

```python
loaded_ref = load.remote()
transformed_ref = transform.remote(loaded_ref)
saved_ref = save.remote(transformed_ref)
ray.get(saved_ref)
```

Driver 退出会影响其拥有的对象和非 Detached Actor 的生命周期。不要把交互式终端中的 Driver 当作生产控制器。

## 4. Task

Task 是一次远程函数调用：

```python
@ray.remote(num_cpus=1)
def preprocess(path: str) -> dict:
    ...

result_ref = preprocess.remote("input.jsonl")
```

Task 的重要属性：

- 默认是异步提交；
- 可以声明 CPU、GPU、内存和自定义资源；
- 输入可以包含普通值和 ObjectRef；
- 返回值由 ObjectRef 表示；
- 失败后是否重试由 Ray 配置和应用语义共同决定；
- Task 不应依赖上一次在某个通用 Worker 中留下的可变状态。

Task 状态只能说明 Ray 看到的执行阶段。若 Task 调用了外部系统，还要结合应用日志、数据库事务和对象存储
写入结果判断业务是否完成。

查看 Task：

```bash
ray summary tasks
ray list tasks --filter 'state=FAILED' --limit 100 --detail
```

大集群应先 Summary 再 List，并限制结果数量。

## 5. Worker

Ray Worker 是执行 Python 代码的进程。Task Worker 与 Actor Worker 的使用方式不同：

- 通用 Worker 可以先后执行多个 Task；
- Actor 通常占用专属 Worker，在该进程内保留 Actor 状态；
- Worker 的 PID、日志、环境变量和可见设备是排障的重要证据；
- Worker OOM、进程退出和节点退出是不同故障层。

下面的 Task 返回运行位置：

```python
import os
import socket

import ray

@ray.remote
def where_am_i() -> dict:
    context = ray.get_runtime_context()
    return {
        "host": socket.gethostname(),
        "pid": os.getpid(),
        "node_id": context.get_node_id(),
        "worker_id": context.get_worker_id(),
        "task_id": context.get_task_id(),
    }

ray.init()
print(ray.get([where_am_i.remote() for _ in range(4)]))
```

Runtime Context 的具体方法和返回类型应按目标版本核对，不要把内部 ID 当作永久业务主键。

## 6. Actor 与 Actor Method

Actor 是有身份、有状态的远程实例：

```python
@ray.remote(max_restarts=1)
class ModelReplica:
    def __init__(self, model_path: str):
        self.model = load_model(model_path)

    def infer(self, inputs):
        return self.model(inputs)

replica = ModelReplica.options(num_gpus=1).remote("/models/demo")
output_ref = replica.infer.remote(inputs)
```

需要区分三个对象：

1. Actor 类定义；
2. `replica` Actor Handle；
3. `replica.infer.remote()` 创建的 Actor Task。

Actor Worker 崩溃后，`max_restarts` 可以让 Ray 重建进程，但内存里的 Python 状态不会凭空恢复。应用必须从
Checkpoint、数据库或其他持久介质重建状态。Actor 方法是否重试也要单独配置，并评估副作用。

查看 Actor：

```bash
ray summary actors
ray list actors --format table
ray get actors <actor-id>
```

## 7. GCS

Global Control Service（GCS）维护集群控制面元数据，例如节点、Actor、Placement Group 和其他全局状态。
应用不应把 GCS 当业务数据库或大对象存储。

排障时重点区分：

- GCS 或 Head 控制面不可用；
- 某个 Raylet 与控制面失联；
- Worker 进程退出；
- Object Store 中某个对象丢失；
- 业务代码返回异常。

这些现象可能最终都表现为请求超时，但恢复方法完全不同。

## 8. Raylet

Raylet 是每个 Node 上的核心节点代理。理解它的作用有助于解释：

- 为什么 Node 仍 Alive，但某个 Worker 已 Dead；
- 为什么 CPU/GPU 看似空闲，Task 仍因资源形状不匹配而 Pending；
- 为什么 Placement Group 无法创建；
- 为什么节点断开后其 Actor、Task 和对象进入恢复流程。

Raylet 不负责业务正确性，也不会替应用决定数据库写入是否应该回滚。

## 9. Object Store

每个 Ray Node 有节点级对象存储，用于保存 Task 返回值和 `ray.put()` 创建的对象。Worker 通过 ObjectRef
引用对象，跨节点依赖可能触发对象传输。

对象归属和引用计数跨进程、跨节点工作。对象是否仍被 Pin、是否已经 Spill、是否因为节点失败而丢失，
不能只看某个 Python 变量名判断。下一篇会专门展开。

## 10. 一次 Task 调用发生什么

以下是简化流程，不表示所有内部 RPC 都必须经过同一条固定路径：

```text
1. Driver调用 function.remote()
2. Ray记录函数、参数、依赖和资源请求
3. 调度器选择满足逻辑资源的Node
4. 目标Node获得或准备输入对象
5. Worker执行函数
6. 返回值进入Ray对象体系
7. Driver或下游Task持有ObjectRef
8. ray.get()在需要时解析结果或抛出远程异常
```

延迟可能来自提交、依赖等待、资源等待、Worker 启动、Runtime Env 安装、对象传输、业务计算或结果拉取。
“Task 很慢”不是一个足够精确的结论。

## 11. 一次 Actor 创建发生什么

```text
1. Driver调用 ActorClass.remote()
2. Ray根据资源和调度策略选择Node
3. 创建专属Actor Worker
4. Worker执行__init__
5. Actor进入ALIVE或创建失败
6. Actor Method按配置排队或并发执行
7. Actor退出、崩溃或随Owner生命周期结束
```

大模型 Actor 的初始化可能包括下载权重、加载模型、显存探测、编译和建立通信组。Actor 长期处于 PENDING、
DEPENDENCIES_UNREADY 或创建中，应分别检查资源、输入对象、Runtime Env 和初始化日志。

## 12. Kubernetes 与 Ray 对象映射

| Kubernetes | Ray | 注意事项 |
| --- | --- | --- |
| RayCluster CR | Ray Cluster | CR Ready 与所有业务 Actor Ready 不是同一条件 |
| Head Pod | Head Node | Pod Running 还需检查 GCS、Raylet 和 Dashboard |
| Worker Pod | Ray Worker Node | 一个 Pod 中通常还有多个 Worker 进程 |
| Container Process | Ray system/Worker process | 容器主进程退出可能使整个 Node 消失 |
| GPU Resource Limit | Ray `GPU` 逻辑资源 | 两层数量和可见设备必须一致 |
| Kubernetes Job/RayJob | Ray Job Submission | 提交器生命周期与实际 Job 生命周期需按 CRD 语义判断 |
| Service | Head/Dashboard/Serve 入口 | 不应公开暴露内部控制端口 |

## 13. 故障判断顺序

```text
集群可达？
→ Node是否Alive？
→ Job/Driver是否存活？
→ Actor是否创建并ALIVE？
→ Task是Pending、Running还是Failed？
→ Worker进程为什么退出或阻塞？
→ 输入ObjectRef是否可用？
→ 外部系统是否真正完成业务提交？
```

先找时间上最早的异常。后续的 `ActorDiedError`、对象丢失和超时可能只是传播结果。

## 14. 掌握标准

- 能画出 Job、Driver、Task、Actor、Worker、Node、Raylet、GCS 和 Object Store；
- 能说明 Actor、Actor Handle 和 Actor Task 的区别；
- 能从 Task ID 映射到 Worker PID 和 Node；
- 能区分 Kubernetes Pod 状态与 Ray 对象状态；
- 能从第一个失败层开始排障，而不是只增加超时。

下一篇：[ObjectRef 与分布式对象存储](./04-ObjectRef与分布式对象存储.md)。

## 15. 官方资料 {/* #官方资料 */}

- [Ray Core Key Concepts](https://docs.ray.io/en/latest/ray-core/key-concepts.html)
- [Ray Architecture Whitepaper](https://docs.ray.io/en/latest/ray-contribute/whitepaper.html)
- [Ray State API](https://docs.ray.io/en/latest/ray-observability/reference/api.html)
- [Ray Jobs Overview](https://docs.ray.io/en/latest/cluster/running-applications/job-submission/index.html)
