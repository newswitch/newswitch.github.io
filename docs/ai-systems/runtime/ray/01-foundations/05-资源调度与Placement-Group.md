---
title: "资源调度与 Placement Group"
sidebar_label: "05. 资源调度与 Placement Group"
sidebar_position: 5
description: "掌握 Ray 逻辑 CPU、GPU、内存、自定义资源、标签、调度策略和 Placement Group，并理解 Kubernetes 与 Ray 两层调度。"
tags: [Ray, 调度, Placement Group, GPU, Gang Scheduling, KubeRay]
---

# 资源调度与 Placement Group

Ray 调度的是逻辑资源请求。Task 或 Actor 只有在某个 Node 的资源形状满足要求时才能运行；Placement Group
进一步把多组资源原子预留，支持分布式训练和多卡推理所需的 Gang Scheduling 与拓扑约束。

需要先记住两个边界：

1. Ray 逻辑资源用于准入和放置，不等于操作系统 cgroup 隔离；
2. 在 KubeRay 中，Kubernetes 先调度 Pod，Ray 再在已加入集群的 Node 上调度 Task 和 Actor。

## 1. 查看集群逻辑资源

```python
import ray

ray.init()

print(ray.cluster_resources())
print(ray.available_resources())
```

- `cluster_resources()` 表示集群已注册的总逻辑资源；
- `available_resources()` 是当前可用视图，会随 Task、Actor 和 Placement Group 改变；
- 两者是调度视角，不应替代 `nvidia-smi`、cgroup、Kubernetes Metrics 或主机监控。

命令行查看：

```bash
ray status
ray list nodes --detail
```

## 2. CPU 资源

```python
@ray.remote(num_cpus=2)
def cpu_job():
    ...
```

`num_cpus=2` 表示执行期间占用两个 Ray CPU Slot。它不自动限制进程只能使用两个物理 CPU，也不保证绑定到
特定 NUMA Node。BLAS、OpenMP、Tokenizer 等库可能创建额外线程，需要结合：

- `OMP_NUM_THREADS` 等线程配置；
- 容器 CPU Request/Limit；
- cpuset 与 CPU Manager；
- NUMA 和 GPU/NIC 拓扑；
- 实际进程 CPU 指标。

调度声明和运行隔离必须同时正确。

## 3. GPU 资源

```python
@ray.remote(num_gpus=1)
def gpu_job():
    import os
    return os.environ.get("CUDA_VISIBLE_DEVICES")
```

Ray 根据 `GPU` 逻辑资源调度，并为 Worker 设置可见设备。仍需验证：

- Ray Node 注册的 GPU 数量；
- 容器实际获得的 GPU 设备；
- `CUDA_VISIBLE_DEVICES`；
- 驱动、CUDA、PyTorch 与镜像兼容；
- MIG 或共享 GPU 的资源语义；
- 进程是否在启动时抢占了额外设备。

`num_gpus=0.5` 等小数资源是一种逻辑共享表达，不会自动提供显存、算力或故障隔离。只有在框架与设备共享
机制已经验证时才能采用。

## 4. 内存与对象存储不是同一种资源

Ray 可以使用内存资源做调度声明，但对象存储容量有独立的运行机制。不要把：

- Task/Actor Worker Heap；
- Ray 系统进程内存；
- Object Store；
- Spill 磁盘；
- GPU HBM

合并成一个“内存资源”。资源调度避免部分过度承诺，但不能替代运行时 OOM 监控和应用容量模型。

## 5. 自定义资源与标签

### 5.1 自定义资源 {/* #自定义资源 */}

自定义资源适合表达数值型容量：

```python
@ray.remote(resources={"license_token": 1})
def licensed_task():
    ...
```

节点必须先注册对应容量。自定义资源只是调度计数器，不会自动检查真实许可证、磁盘带宽或外部设备状态。

### 5.2 标签 {/* #标签 */}

较新的 Ray 版本支持用节点标签和选择器表达加速器类型、故障域等放置条件。该能力具有版本边界，部分字段
仍可能处于 Beta。使用前必须核对目标版本文档和 KubeRay 支持情况。

不要为了“指定节点”滥用数值型自定义资源。标签适合身份和类别，Resource 适合可消耗数量。

## 6. 默认调度与 SPREAD

默认策略在数据本地性和负载分布之间做选择，具体算法会随版本演进。应用不应依赖“任务一定按节点编号轮询”
这样的未声明行为。

可以显式请求分散：

```python
@ray.remote(scheduling_strategy="SPREAD")
def spread_task():
    ...
```

SPREAD 是尽力而为，不等价于每个 Task 必须位于不同节点。严格的多 Worker 放置通常使用 Placement Group。

低层 Node Affinity 可以指定节点，但会降低弹性和恢复能力。除非高层策略无法表达需求，否则不应把临时
Node ID 写入长期业务配置。

## 7. Placement Group 与 Bundle

Placement Group 是一组 Bundle：

```python
from ray.util.placement_group import placement_group

pg = placement_group(
    bundles=[
        {"CPU": 2, "GPU": 1},
        {"CPU": 2, "GPU": 1},
    ],
    strategy="STRICT_PACK",
)

ray.get(pg.ready())
```

每个 Bundle 必须能完整放进某一个 Node。即使集群总共有 8 个 CPU，两个节点各 4 CPU，也无法放置单个
`{"CPU": 8}` Bundle。

Placement Group 创建是异步的。调用返回不代表预留完成，生产代码应等待 Ready，并为不可调度建立超时、
状态观察和取消逻辑。

## 8. 四种放置策略

| 策略 | 语义 | 常见用途 | 风险 |
| --- | --- | --- | --- |
| `PACK` | 尽量放到少量节点 | 提高数据本地性、减少跨节点通信 | 必要时可能跨节点 |
| `STRICT_PACK` | 所有 Bundle 必须在同一节点 | 单机多 GPU TP、强本地性 | 单节点放不下则一直无法创建 |
| `SPREAD` | 尽量分散到不同节点 | 降低单节点集中度 | 不保证完全分散 |
| `STRICT_SPREAD` | 每个 Bundle 位于不同节点 | 跨节点副本、故障域实验 | 节点数不足时不可调度 |

策略选择必须对应业务目标。多卡推理并非总是 SPREAD：单机 TP 通常希望 GPU 同机且互联紧密；高可用的独立
模型副本则可能希望分散到不同节点。

## 9. 把 Task 和 Actor 放入 Placement Group

创建 Placement Group 只是预留资源，Task/Actor 还必须使用它：

```python
import ray
from ray.util.placement_group import placement_group
from ray.util.scheduling_strategies import PlacementGroupSchedulingStrategy

ray.init()

pg = placement_group(
    [{"CPU": 1}, {"CPU": 1}],
    strategy="STRICT_SPREAD",
)
ray.get(pg.ready())

@ray.remote
def worker(index: int) -> int:
    return index

refs = []
for bundle_index in range(2):
    refs.append(
        worker.options(
            num_cpus=1,
            scheduling_strategy=PlacementGroupSchedulingStrategy(
                placement_group=pg,
                placement_group_bundle_index=bundle_index,
            ),
        ).remote(bundle_index)
    )

print(ray.get(refs))
```

高层库可能自动创建和使用 Placement Group，但排障时仍需要查看其 Bundle 形状、策略、状态和归属。

## 10. 为什么 Placement Group 会 Pending

常见原因：

- 集群总资源不足；
- 总量足够，但单个 Bundle 无法放入任何节点；
- `STRICT_PACK` 要求的单节点资源不足；
- `STRICT_SPREAD` 要求的节点数量不足；
- GPU 型号、标签或自定义资源不匹配；
- 资源已被 Actor 或其他 Placement Group 预留；
- Kubernetes Worker Pod 尚未创建、Pending 或未加入 Ray；
- Autoscaler 无法提供符合资源形状的新节点。

检查：

```bash
ray status
ray list placement-groups --detail
ray list nodes --detail
ray list actors --filter 'state=PENDING' --detail
```

`available_resources()` 只看剩余总量可能不够，还要检查资源分布到哪些 Node。

## 11. Fragmentation 与资源死锁

### 11.1 资源碎片 {/* #资源碎片 */}

例如两个节点各剩一张 GPU，但新工作负载要求 `STRICT_PACK` 的两张 GPU。集群剩余总量是两张，实际仍无法
调度。扩容、驱逐低优先级负载、改变资源形状或重建 Placement Group 才可能解决。

### 11.2 父任务占用资源等待子任务 {/* #父任务占用资源等待子任务 */}

父 Task/Actor 已占用全部 CPU，又同步等待需要 CPU 的子 Task，可能形成资源等待。解决方式包括重新设计
资源声明、避免阻塞式嵌套、为子任务保留资源或使用更合适的并发结构。

### 11.3 预留但未使用 {/* #预留但未使用 */}

Placement Group 已预留资源，但实际 Task 没有使用对应 Scheduling Strategy，导致预留资源空闲、普通资源又
不足。必须检查 Reserved 与 Used，而不只是 GPU 利用率。

## 12. Kubernetes 与 Ray 两层调度

```text
第一层：Kubernetes Scheduler
Worker Pod资源请求 → 选择Kubernetes Node → 挂载GPU/存储/网络

第二层：Ray Scheduler
Task/Actor资源请求 → 选择已加入Ray的Worker Node → 启动Worker进程
```

典型不一致：

| Kubernetes 层 | Ray 层 | 结果 |
| --- | --- | --- |
| Pod 没申请 GPU | Ray 错误注册 GPU | Task 可能被放置但进程看不到设备 |
| Pod 申请 4 GPU | Ray 只注册 2 GPU | 两张卡无法被 Ray 使用 |
| Worker Pod Pending | Placement Group 等待 GPU | Ray 只显示需求，根因在 Kubernetes 调度 |
| Pod 分到普通 GPU 节点 | Task 要求特定标签 | Actor 在 Ray 层 Pending |
| K8s 多副本分散 | `STRICT_PACK` 要求同 Node | PG 无法创建 |

排障必须把 Ray Node 映射到 Pod 和 Kubernetes Node，再核对真实 GPU UUID、拓扑和可见设备。

## 13. 多卡大模型推理中的 Placement Group

假设一个模型实例需要 4 个 GPU Worker：

```text
单机TP=4
→ 4个GPU Bundle
→ STRICT_PACK或高层框架等价约束
→ 同一节点
→ 再检查四张GPU的NVLink/PCIe拓扑

跨节点TP/PP
→ 多个GPU Bundle
→ PACK/SPREAD与框架策略
→ Ray完成Worker放置
→ vLLM建立Rank和通信组
→ NCCL选择实际网络路径
```

Placement Group 只保证逻辑放置，不保证选择到同一 NVLink Island，也不保证 RDMA 可用。还需要拓扑感知、
节点标签、设备插件、NCCL 测试和真实模型压测。

## 14. 生命周期与清理

Placement Group 通常与创建者生命周期相关，也可以使用命名和 Detached 生命周期。手工删除会释放预留资源，
并可能终止仍在其中运行的 Task/Actor：

```python
from ray.util import remove_placement_group

remove_placement_group(pg)
```

删除前必须确认归属和业务影响。不要看到“GPU 被预留但利用率为零”就直接删除生产 Placement Group。

## 15. 调度排障清单

- [ ] Task/Actor 请求的资源名称和数量正确；
- [ ] 集群总资源和各 Node 资源形状都满足；
- [ ] Placement Group 策略符合单机或跨节点目标；
- [ ] Bundle 可以完整放进候选节点；
- [ ] Task/Actor 实际使用了 Placement Group；
- [ ] GPU 逻辑资源与容器可见设备一致；
- [ ] Kubernetes Worker Pod 已调度并加入 Ray；
- [ ] 标签、自定义资源和加速器类型匹配；
- [ ] Autoscaler 能提供目标 Worker Group；
- [ ] 没有父子任务资源等待或遗留预留。

## 16. 掌握标准

- 能解释逻辑资源与物理隔离的区别；
- 能根据工作负载选择 PACK、STRICT_PACK、SPREAD 或 STRICT_SPREAD；
- 能识别“总量足够但资源形状不匹配”；
- 能从 Placement Group 映射到 Task、Actor、Ray Node、Pod 和真实 GPU；
- 能说明 Placement Group、Kubernetes 调度与 NCCL 拓扑分别解决什么问题。

下一阶段将进入 Ray Core 编程，从 Task 的参数、返回值、嵌套、重试和取消开始。

## 17. 官方资料 {/* #官方资料 */}

- [Ray Resources](https://docs.ray.io/en/latest/ray-core/scheduling/resources.html)
- [Ray Scheduling](https://docs.ray.io/en/latest/ray-core/scheduling/index.html)
- [Placement Groups](https://docs.ray.io/en/latest/ray-core/scheduling/placement-group.html)
- [Use Labels to Control Scheduling](https://docs.ray.io/en/latest/ray-core/scheduling/labels.html)
- [KubeRay Documentation](https://docs.ray.io/en/latest/cluster/kubernetes/index.html)
