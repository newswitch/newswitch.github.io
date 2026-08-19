---
title: "任务重试、Actor 恢复与容错语义"
sidebar_label: "09. 任务重试、Actor 恢复与容错语义"
sidebar_position: 9
description: "区分 Task、Actor、Object、Node 与 GCS 故障，理解 at-most-once、at-least-once、谱系重建、Checkpoint、幂等和故障演练。"
tags: [Ray, 容错, 重试, Actor, Checkpoint, 幂等]
---

# 任务重试、Actor 恢复与容错语义

Ray 能重试 Task、重启 Actor、重建部分对象，并不代表业务获得 exactly-once。分布式故障常发生在“远端已经
完成，但结果确认尚未送达”的窗口，调用者无法仅凭超时判断副作用是否发生。

正确设计顺序是：先定义业务语义，再选择 Ray 重试和恢复参数。

## 1. 五类故障对象

| 故障对象 | 示例 | 主要机制 |
| --- | --- | --- |
| Task | Python 异常、Worker 崩溃、取消 | 异常传播、重试、取消 |
| Actor | 进程退出、初始化失败、Owner 退出 | Actor 重启、Task 重试、Checkpoint |
| Object | 保存节点退出、Owner 退出、无法重建 | 副本、谱系重建、持久存储 |
| Node | 主机宕机、Pod 删除、网络隔离 | 节点判死、任务重调度、Actor/PG 恢复 |
| GCS/Head | 控制面进程或 Head 节点失败 | GCS 容错、KubeRay 恢复、集群重建 |

后续异常可能是传播结果。例如 Node OOM 先杀死 Actor Worker，调用者最后只看到 Actor Task 超时。必须沿时间线
找到第一条异常。

## 2. Task 应用异常

```python
import ray

@ray.remote
def parse(record: str) -> dict:
    if not record:
        raise ValueError("empty record")
    return decode(record)

ref = parse.remote("")
try:
    ray.get(ref)
except ray.exceptions.RayTaskError as error:
    print(error)
```

应用异常通常由代码或输入引起。盲目重试确定性的坏数据只会重复失败。应分类：

- 可重试：瞬时网络错误、受控限流、临时服务不可用；
- 不可重试：Schema 错误、权限错误、模型不兼容、确定性计算异常；
- 需要人工判断：超时、远端未知提交状态、资源耗尽。

## 3. Task 系统故障与重试

```python
@ray.remote(max_retries=3)
def build_partition(partition_id: str):
    ...
```

非 Actor Task 对部分系统故障有默认重试行为，准确默认值和异常重试范围必须以目标版本为准。不要让生产语义
依赖一个从未显式记录的默认值。

重试配置应包含：

- 最大尝试次数；
- 退避和抖动；
- 总 Deadline；
- 可重试异常集合；
- 单次尝试 ID；
- 最终失败去向；
- 对下游的限速。

Ray Task 自身的重试间隔控制能力若不能满足业务需求，可由协调层显式管理，但不要与 Ray 自动重试叠加成未知
次数。

## 4. At-most-once 与 At-least-once

### 4.1 At-most-once {/* #at-most-once */}

任务最多执行一次；遇到不确定故障时可能直接报告失败。优点是降低重复副作用，代价是可能丢失本可重试的工作。

### 4.2 At-least-once {/* #at-least-once */}

任务可以重试，保证“至少尝试完成”，但可能执行多次。适合只读或幂等操作。

### 4.3 Exactly-once 是端到端协议 {/* #exactly-once是端到端协议 */}

Ray 的执行次数设置不能单独提供 exactly-once。通常需要：

```text
稳定业务操作ID
→ 条件写/唯一约束
→ 临时结果
→ 原子提交标记
→ 重试查询已有提交
→ 返回同一业务结果
```

## 5. 幂等写出示例

```python
@ray.remote(max_retries=3)
def publish_partition(run_id: str, partition_id: str, rows) -> str:
    operation_id = f"{run_id}:{partition_id}"
    if committed(operation_id):
        return committed_uri(operation_id)
    temp_uri = write_temp(operation_id, rows)
    checksum = verify(temp_uri)
    return commit_if_absent(operation_id, temp_uri, checksum)
```

`commit_if_absent` 必须由支持原子条件写或事务的外部系统实现。先检查再写若没有并发控制，仍会竞态。

## 6. Actor 进程恢复

```python
@ray.remote(max_restarts=3, max_task_retries=1)
class Aggregator:
    def __init__(self, checkpoint_uri: str):
        self.checkpoint_uri = checkpoint_uri
        self.state = restore(checkpoint_uri)
```

Actor 重启时重新运行构造函数。内存中的 `self.state` 不会自动恢复。构造函数应快速、可重复，并能区分：

- 第一次创建；
- 正常重启；
- Checkpoint 不存在；
- Checkpoint 损坏；
- Schema/代码版本不兼容；
- 外部依赖暂时不可用。

无限重启会制造日志、下载、GPU 初始化和下游连接风暴。必须设置重启预算和熔断。

## 7. Actor Task 的不确定窗口

可能发生：

```text
Actor完成数据库写入
→ Actor进程在返回结果前退出
→ 调用者收到RayActorError
→ Actor Task被重试
→ 数据库写入第二次
```

因此即使配置是 at-most-once，调用者也不能从失败反推“方法一定没有执行完成”；启用 Actor Task 重试后更要按
at-least-once 设计副作用。

## 8. Object 重建

由 Task 生成的对象在数据副本丢失时，Ray 可能利用任务谱系重新执行生产 Task。限制包括：

- Owner 必须仍存活；
- 生产 Task 及传递依赖可重建；
- 未超过重试上限；
- Task 应确定且幂等；
- `ray.put()` 创建的对象不能依赖任务谱系重建；
- Actor Task 返回值的重建受 Actor 重试配置限制。

必须长期保存的数据写入持久存储。Object Store 是运行时数据平面，不是备份系统。

## 9. Owner 故障

ObjectRef 的 Owner 保存关键元数据。Owner 进程死亡与只丢失对象数据不同；即使其他节点曾有数据副本，也可能
因为 Owner 丢失而无法继续使用。

长期对象不要由短生命周期临时 Task 创建并向外泄漏。应由稳定 Job/Actor 管理，或发布到外部持久存储后只传递
持久 URI 和校验信息。

## 10. Node 故障

节点退出会同时影响：

- 该节点上的 Worker；
- Actor 进程；
- 运行和 Pending Task；
- Object Store 数据；
- Placement Group Bundle；
- 本地 Spill、缓存和模型文件。

恢复能否成功取决于其他节点是否有足够资源、对象能否重建、Actor 是否允许重启以及数据是否位于共享持久介质。
一个 8 GPU `STRICT_PACK` Actor 在唯一 8 GPU 节点退出后，不能靠 Task 重试恢复。

## 11. GCS 与 Head 故障

GCS 管理节点、Actor、Placement Group 等集群元数据。是否启用 GCS Fault Tolerance、使用何种持久后端和 KubeRay
恢复流程具有明确版本边界，应按目标 Ray/KubeRay 官方文档配置和演练。

不要因为 Worker 上已有 Task 仍短暂运行，就断言控制面已经恢复。需要验证：

- 新 Node 能否注册；
- 新 Actor/Placement Group 能否创建；
- 资源状态是否更新；
- Job/Serve 控制器是否恢复；
- 客户端是否重新连接。

## 12. Checkpoint 的一致性

Checkpoint 不只是序列化一个 Python 字典。分布式状态要定义：

- 哪些 Actor/Rank 参与；
- 全局 Step 或 Epoch；
- 每个分片的校验和；
- 完整分片清单；
- 原子发布点；
- 代码、依赖和数据版本；
- 跨拓扑恢复策略。

```text
写入各分片临时路径
→ 每个参与者校验并上报
→ Coordinator写Manifest
→ 原子发布CURRENT
→ 清理旧临时分片
```

只让 Rank 0 写一份本地文件，不一定能恢复分片状态或 Actor 集合。

## 13. 重试预算

```text
请求总预算
├─ 排队
├─ 第1次尝试
├─ 退避
├─ 第2次尝试
└─ 返回/降级
```

重试必须受总 Deadline 约束。入口、Ray Task、Actor、HTTP Client 和数据库 Driver 同时各重试三次，最坏可能放大
成多层乘积。规定唯一主重试层，其他层只做有限的连接级恢复。

## 14. 故障演练矩阵

| 注入 | 预期证据 | 验收结果 |
| --- | --- | --- |
| Task 抛可重试异常 | 尝试次数、相同操作 ID | 最终成功且无重复结果 |
| Task 抛确定性数据错误 | 一次失败、坏数据记录 | 不进行无意义重试 |
| Kill Actor Worker | Actor DEAD/RESTARTING、构造日志 | 从已提交 Checkpoint 恢复 |
| 删除 Worker Pod | Node Lost、PG/Actor 状态变化 | 在容量允许时恢复，否则明确告警 |
| 丢失 Object Store 数据 | 重建 Task 或 ObjectLostError | 行为符合数据来源设计 |
| Head/GCS 故障 | 控制面指标和客户端错误 | 按既定 RTO 恢复或重建 |
| Sink 返回未知提交状态 | 幂等查询 | 不重复发布业务结果 |

## 15. 常见错误

- 对所有异常无限重试；
- 把 Actor 重启当状态恢复；
- 把 Object Store 当持久存储；
- 使用随机文件名导致每次重试产生新结果；
- 只保留最后一条超时，不保留第一次 Worker/OOM 异常；
- 没有总 Deadline，多层重试持续占用资源；
- 恢复演练只 Kill Python 函数，不覆盖 Pod、Node、网络和存储。

## 16. 掌握标准

- 能区分 Task、Actor、Object、Node 和 GCS 故障；
- 能解释 at-most-once、at-least-once 和 exactly-once 的边界；
- 能为外部副作用设计稳定操作 ID 与原子提交；
- 能说明 `max_restarts` 与 `max_task_retries` 的区别；
- 能判断对象是否具备谱系重建条件；
- 能设计包含恢复目标和业务校验的故障演练。

下一篇：[Runtime Env 依赖、代码与环境分发](./10-Runtime-Env依赖代码与环境分发.md)。

## 17. 官方资料 {/* #官方资料 */}

- [Ray Fault Tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance.html)
- [Task Fault Tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/tasks.html)
- [Actor Fault Tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/actors.html)
- [Object Fault Tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/objects.html)
- [GCS Fault Tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/gcs.html)
