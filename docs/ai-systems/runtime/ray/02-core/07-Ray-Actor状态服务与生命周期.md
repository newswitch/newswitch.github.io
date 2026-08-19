---
title: "Ray Actor 状态服务与生命周期"
sidebar_label: "07. Ray Actor 状态服务与生命周期"
sidebar_position: 7
description: "掌握 Ray Actor 的状态、句柄、资源、命名空间、并发、命名与 Detached 生命周期，以及重启和状态恢复边界。"
tags: [Ray, Actor, 状态服务, AsyncIO, 并发, 容错]
---

# Ray Actor 状态服务与生命周期

Actor 是绑定到专属 Worker 进程的有状态远程实例。它适合模型副本、连接复用、缓存、协调器和需要连续状态的
服务；如果只需要无状态计算，Task 通常拥有更灵活的调度和 Worker 复用能力。

## 1. Actor、Handle 与 Actor Task

```python
import ray

ray.init()

@ray.remote(num_cpus=1)
class Counter:
    def __init__(self) -> None:
        self.value = 0

    def increment(self) -> int:
        self.value += 1
        return self.value

counter = Counter.remote()
result_ref = counter.increment.remote()
print(ray.get(result_ref))
```

分别对应：

- `Counter`：远程 Actor 类；
- `Counter.remote()`：请求创建 Actor；
- `counter`：Actor Handle；
- `counter.increment.remote()`：提交 Actor Task；
- `result_ref`：Actor Task 的结果引用。

Actor Handle 可以传给其他 Task 或 Actor，使其调用同一实例。Handle 是能力边界，不能随意暴露给不可信代码。

## 2. Actor 适用场景

### 2.1 昂贵初始化复用 {/* #昂贵初始化复用 */}

```python
@ray.remote(num_gpus=1)
class ModelWorker:
    def __init__(self, model_path: str):
        self.model = load_model(model_path)

    def infer(self, batch):
        return self.model(batch)
```

权重只在 Actor 初始化时加载，后续调用复用模型与 GPU Context。

### 2.2 有状态协调 {/* #有状态协调 */}

例如限流器、分片目录、进度协调或缓存。关键状态仍要持久化；Actor 内存不是数据库。

### 2.3 长期连接 {/* #长期连接 */}

数据库连接池、HTTP Client、消息客户端可以在 Actor 生命周期内复用，但要实现断线重连、凭证轮换和优雅关闭。

## 3. 资源声明必须显式

```python
replica = ModelWorker.options(
    num_cpus=4,
    num_gpus=1,
    memory=16 * 1024**3,
    name="model-replica-0",
).remote("/models/demo")
```

Actor 的资源默认行为可能为了兼容而不直观。生产代码应明确声明 CPU、GPU 和必要资源，不依赖默认 CPU 数。
资源在 Actor 存活期间被占用，而不是每个方法调用结束后释放。

## 4. 默认串行执行

普通 Actor 的方法默认按单线程模型顺序执行：

```python
@ray.remote
class Ledger:
    def __init__(self):
        self.balance = 0

    def deposit(self, amount: int) -> int:
        self.balance += amount
        return self.balance
```

串行降低了 Actor 内部状态竞争，但不提供外部事务，也不保证跨多个 Actor 的原子性。长时间运行的方法会阻塞
后续健康检查和控制调用，应拆分工作或使用并发模型。

## 5. Async Actor

Actor 定义中包含异步方法时，可以在同一事件循环并发处理 I/O：

```python
import asyncio
import ray

@ray.remote
class Fetcher:
    def __init__(self):
        self.in_flight = 0

    async def fetch(self, url: str) -> str:
        self.in_flight += 1
        try:
            await asyncio.sleep(0.1)
            return url
        finally:
            self.in_flight -= 1

    async def status(self) -> int:
        return self.in_flight
```

`async` 只有在代码真正 `await` 可让出控制权的 I/O 时才产生并发。同步阻塞库会卡住事件循环；CPU 密集 Python
代码也不会因为 `async` 自动并行。

## 6. Threaded Actor

线程并发适合会释放 GIL 的本地库调用或阻塞 I/O。纯 Python CPU 代码仍受 GIL 影响。线程模型还要求 Actor
内部状态具备锁、队列或无共享写设计。

`max_concurrency` 的默认值和不同 Actor 类型的行为应按目标版本核对，不应直接复制一个高并发数字。

## 7. Concurrency Group

可以把方法分到不同并发组，使健康检查不会被长请求完全挤占：

```python
import ray

@ray.remote(concurrency_groups={"serve": 8, "control": 1})
class Service:
    @ray.method(concurrency_group="serve")
    async def handle(self, request):
        ...

    @ray.method(concurrency_group="control")
    async def health(self):
        return {"ready": True}
```

并发组是配额，不是优先级调度器。若共享锁、GPU Kernel 或下游连接池已饱和，单独的健康组也可能变慢。

## 8. Named Actor 与 Namespace

默认 Actor Handle 只在应用传递范围内可见。命名 Actor 可以由同一 Namespace 中的其他 Job 查找：

```python
ray.init(namespace="inference")

router = Router.options(name="router").remote()
same_router = ray.get_actor("router", namespace="inference")
```

名称应具有明确所有权、版本和环境边界。创建前“先查再建”可能存在竞争；生产控制器要设计唯一创建者和冲突处理。

Namespace 用于名称隔离，不是强安全租户边界。网络、身份、权限和集群隔离仍需底层平台控制。

## 9. Detached Actor

普通 Actor 的生命周期通常受 Owner 影响。Detached Actor 可以跨创建 Job 存活，直到被显式终止或集群销毁。

适用前必须回答：

- 谁是唯一控制器；
- 怎样发现和复用已有实例；
- 谁负责升级和删除；
- Actor 失去业务 Owner 后如何避免成为孤儿；
- 凭证与配置怎样轮换；
- 集群重启后是否需要重建。

不要把 Detached Actor 当数据库或系统守护进程的默认替代品。

## 10. Actor 重启

```python
@ray.remote(max_restarts=3, max_task_retries=1)
class RecoverableWorker:
    def __init__(self, checkpoint_uri: str):
        self.state = load_checkpoint(checkpoint_uri)
```

`max_restarts` 允许 Ray 在 Actor 进程异常退出后重新运行构造函数。它不会自动恢复 `self` 中原来的业务状态。
构造函数必须能够：

- 重复执行；
- 从持久 Checkpoint 恢复；
- 处理部分初始化制品；
- 验证版本和状态 Schema；
- 避免重复注册或重复扣费等副作用。

## 11. Actor Task 重试

Actor 重启次数和 Actor Task 重试次数是两个选项：

- `max_restarts`：进程可以重建几次；
- `max_task_retries`：未确认完成的 Actor Task 可以重新提交几次。

默认 Actor Task 倾向于 at-most-once；启用重试后可能接近 at-least-once。网络或进程在方法执行完成后、结果确认前
失败时，调用者可能看到失败，但副作用实际已经发生。

因此修改外部状态的方法必须使用：

- 请求幂等键；
- 乐观锁或条件更新；
- 事务和唯一约束；
- 临时结果加 Commit Marker；
- 可审计的尝试编号。

## 12. Checkpoint 设计

```text
内存状态更新
→ 生成新Checkpoint
→ 写临时对象
→ 校验内容和版本
→ 原子发布CURRENT指针
→ 返回成功
```

Checkpoint 应包含 Schema、业务版本、序列号、校验和和生成时间。恢复时不能只取“目录中名字最大”的文件，
而要读取已提交指针并验证完整性。

Checkpoint 周期要平衡：

- 恢复点目标（RPO）；
- 写入吞吐与延迟；
- 状态大小；
- 重放成本；
- 多 Actor 一致性。

## 13. Actor Handle 与所有权

创建 Actor 的进程通常是 Owner。Owner 退出可能导致 Actor 和相关对象进入清理或失败流程。Actor Handle 被另一个
Task 持有，不必然改变所有权语义。

设计长期 Actor 时，不要让临时请求 Task 成为 Owner；应由稳定 Driver、Serve Controller 或受管服务对象创建。

## 14. 终止 Actor

正常情况下，应提供协作式关闭：

```python
@ray.remote
class Worker:
    def close(self):
        self.flush()
        self.client.close()
```

强制终止：

```python
ray.kill(actor_handle, no_restart=True)
```

强制 Kill 可能跳过 Flush、上下文退出和外部提交。执行前确认 Actor 身份、重启策略和业务影响。在 KubeRay/Ray
Serve 管理的对象中，应优先让上层控制器完成缩容或升级。

## 15. Actor 队列与背压

调用 Actor Method 仍会创建排队工作。无限向一个 Actor 提交请求会导致：

- Pending Actor Task 和 ObjectRef 增长；
- 请求已经超时但仍在队列中执行；
- Actor 重启后产生重试风暴；
- 单个慢方法阻塞控制操作；
- Driver 内存持续上升。

调用方应限制在途请求，服务层应设置最大并发、队列边界、Deadline 和拒绝策略。

## 16. 常见 Actor 模式

| 模式 | 用途 | 关键风险 |
| --- | --- | --- |
| Model Replica | 复用权重和 GPU | 显存、长初始化、健康检查、批处理 |
| Pool Worker | 一组同构 Actor | 负载不均、慢 Actor、扩缩容 |
| Coordinator | 管理分片和阶段 | 单点、状态恢复、资源等待 |
| Parameter Server | 聚合共享参数 | 热点、网络、同步一致性 |
| Cache Actor | 缓存昂贵结果 | 内存无界、失效、节点故障 |
| Supervisor | 监控并重建子 Actor | Owner、重启风暴、状态重复 |

## 17. 排障映射

```bash
ray summary actors
ray list actors --filter 'state=DEAD' --detail
ray get actors <actor-id>
ray logs actor --help
```

| 现象 | 首要检查 |
| --- | --- |
| Actor PENDING | 资源形状、Placement Group、Runtime Env、目标标签 |
| Actor 创建失败 | `__init__` 第一条异常、依赖、模型/配置路径 |
| 方法全部卡住 | 默认串行、同步阻塞、锁、下游 I/O |
| Actor 反复重启 | 首次崩溃、OOM、构造函数副作用、重启上限 |
| 状态恢复为空 | Checkpoint 是否发布、版本是否匹配、恢复路径 |
| GPU 空闲但 Actor Pending | Ray 资源、Pod GPU、Placement Group 是否一致 |

## 18. 掌握标准

- 能区分 Actor、Handle、Actor Worker 和 Actor Task；
- 能判断使用 Task 还是 Actor；
- 能解释普通、Async 和 Threaded Actor 的并发边界；
- 能设计命名、Namespace、Owner 和 Detached 生命周期；
- 能区分进程重启与业务状态恢复；
- 能为 Actor 方法重试设计幂等性和 Checkpoint。

下一篇：[异步并发、背压与任务依赖](./08-异步并发背压与任务依赖.md)。

## 19. 官方资料 {/* #官方资料 */}

- [Ray Actors](https://docs.ray.io/en/latest/ray-core/actors.html)
- [AsyncIO and Actor Concurrency](https://docs.ray.io/en/latest/ray-core/actors/async_api.html)
- [Concurrency Groups](https://docs.ray.io/en/latest/ray-core/actors/concurrency_group_api.html)
- [Named Actors](https://docs.ray.io/en/latest/ray-core/actors/named-actors.html)
- [Actor Fault Tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/actors.html)
