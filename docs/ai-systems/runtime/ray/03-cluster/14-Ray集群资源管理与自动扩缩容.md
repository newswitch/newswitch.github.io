---
title: "Ray 集群资源管理与自动扩缩容"
sidebar_label: "14. Ray 集群资源管理与自动扩缩容"
sidebar_position: 14
description: "理解 Ray Autoscaler 如何根据 Task、Actor 和 Placement Group 的逻辑资源需求选择 Worker Group，设计节点类型、上下限、冷启动、缩容和容量保护。"
tags: [Ray, Autoscaler, 自动扩缩容, 资源调度, Placement Group, 云计算]
---

# Ray 集群资源管理与自动扩缩容

Ray Scheduler 决定 Task、Actor 和 Placement Group 放到哪个已存在的 Node；Ray Autoscaler 根据当前和待处理的
逻辑资源需求，决定是否增加或删除 Worker Node。两者不是同一个组件。

```text
Task/Actor/Placement Group提出资源需求
→ Scheduler尝试放置
→ 出现Pending资源形状
→ Autoscaler模拟需要哪些Worker Group
→ 云Provider或KubeRay创建节点/Pod
→ 新Node加入Ray
→ Scheduler放置工作
```

## 1. 先从静态集群开始

自动扩缩容会引入：

- 节点供应延迟；
- 镜像和依赖冷启动；
- 模型下载与加载；
- 云配额和库存；
- 缩容数据清理；
- 更复杂的成本和故障状态。

初学和新工作负载应先在固定节点数上得到正确性、容量和性能基线，再开启 Autoscaler。否则无法区分应用问题、
资源声明问题和节点供应问题。

## 2. 扩容看逻辑需求，不看利用率猜测

Autoscaler 主要响应 Ray 中 Pending 的逻辑资源需求：

```python
@ray.remote(num_cpus=4, num_gpus=1)
def train_shard(...):
    ...
```

如果任务实际占满 GPU，却没有声明 `num_gpus`，Autoscaler 不会仅凭 `nvidia-smi` 利用率自动理解需要更多 GPU。
反过来，错误声明大量 GPU 会触发无意义扩容或永久 Pending。

因此扩缩容的第一输入是正确资源建模，而不是先调 Autoscaler 参数。

## 3. Worker Group / Node Type

每种 Worker Group 描述一类同构节点：

| 类型 | 示例资源 | 适用工作 |
| --- | --- | --- |
| CPU Small | 8 CPU、32 GiB | 轻量预处理、协调 |
| CPU Memory | 32 CPU、256 GiB | 大对象转换、数据处理 |
| GPU Inference | 32 CPU、4 GPU | 单机 TP=4、模型副本 |
| GPU Distributed | 64 CPU、8 GPU、高速 NIC | 多机训练/推理 |

组内实例应具有可预期的 CPU 架构、GPU 型号、网络、磁盘和镜像。只写 `GPU: 4` 无法表达 NVLink Island、NIC
拓扑和显存容量，应结合标签、节点类型和调度约束。

## 4. 最小/最大节点数

典型配置包含集群总 `max_workers`，以及每种节点类型的 `min_workers`、`max_workers`：

```yaml
cluster_name: ray-production
max_workers: 20
idle_timeout_minutes: 10

available_node_types:
  ray.head.default:
    min_workers: 0
    max_workers: 0
    node_config:
      instance_type: <HEAD_INSTANCE_TYPE>
    resources:
      head_control: 1

  ray.worker.cpu:
    min_workers: 2
    max_workers: 10
    node_config:
      instance_type: <CPU_INSTANCE_TYPE>
    resources:
      CPU: 16

  ray.worker.gpu:
    min_workers: 0
    max_workers: 8
    node_config:
      instance_type: <GPU_INSTANCE_TYPE>
    resources:
      CPU: 32
      GPU: 4
```

这是结构示意，不是可直接应用的云配置。Provider、认证、镜像、网络、磁盘和启动命令必须使用目标版本官方样例。

设置原则：

- `min_workers` 承担稳定基线和冷启动缓冲；
- `max_workers` 同时受预算、云配额、IP、存储和业务容量约束；
- 总上限与各组上限必须一致；
- 修改最大值可能触发立即缩减，变更前评估运行负载。

## 5. Head Node 不应承载大规模业务

Head 承担 GCS、Autoscaler、Dashboard 和 Job 控制面。大集群中应避免普通业务 Task 抢占 Head 的 CPU、内存和
磁盘。

可采用：

- Head 使用独立 Node Type；
- 只注册控制面自定义资源；
- 业务 Task 显式请求 Worker 标签/资源；
- 监控 Head CPU、内存、磁盘和 GCS；
- 不在 Head 本地保存唯一模型或结果。

具体“让 Head 不参与调度”的配置方式随 Cluster Launcher/KubeRay 版本变化，必须以目标配置 Schema 为准。

## 6. Placement Group 如何触发扩容

Placement Group 提交多个 Bundle：

```python
pg = placement_group(
    bundles=[{"CPU": 4, "GPU": 1}] * 8,
    strategy="STRICT_SPREAD",
)
```

Autoscaler 会尝试寻找能满足全部资源形状的 Worker Group。但以下请求不会因“总资源最终够”就一定成功：

- 单个 Bundle 大于任何节点类型；
- `STRICT_PACK` 要求 8 GPU，但只有 4 GPU 节点；
- `STRICT_SPREAD` 需要 8 个节点，组上限只有 4；
- 请求的标签/自定义资源没有任何 Worker Group 提供；
- 云库存或配额无法创建目标节点。

## 7. Infeasible 与暂时 Pending

```text
暂时Pending
→ 存在可满足的Node Type
→ 只是当前容量不足或节点正在启动

Infeasible
→ 没有任何允许的Node Type能满足资源形状
→ 等待不会自行解决
```

检查：

```bash
ray status
ray list placement-groups --detail
ray list actors --filter 'state=PENDING' --detail
ray list nodes --detail
```

同时查看 Autoscaler 日志、Provider 事件、云配额和实例库存。

## 8. 扩容时间线

GPU/LLM Worker 从需求出现到真正 Ready 可能经历：

```text
资源需求出现
→ Autoscaler决策
→ Provider创建实例
→ OS/容器运行时启动
→ 拉取镜像
→ Ray Worker加入
→ Runtime Env准备
→ 下载/加载模型
→ CUDA Graph/通信组初始化
→ 业务预热
→ Ready
```

只看“实例创建耗时”会严重低估大模型扩容时间。需要分别记录每一阶段，并为入口队列和容量预留设计冷启动缓冲。

## 9. 缩容与 Idle

Autoscaler 判断 Worker 是否空闲时会考虑活跃 Task、Actor、对象等状态。一个节点 CPU/GPU 利用率为零，不代表可
立即删除：

- Detached/长期 Actor 仍占用资源；
- Placement Group 仍预留 Bundle；
- 节点保存仍被引用的对象或 Spill；
- Serve Replica 处于等待请求；
- 外部写入或 Checkpoint 尚未完成。

缩容过快会造成反复启动和销毁。`idle_timeout_minutes` 应大于典型短暂空闲，并结合节点/模型冷启动成本调优。

## 10. Scale-to-zero 边界

CPU 批任务可能适合缩到零；大型模型服务往往需要最小热副本。缩到零之前必须回答：

- 首请求允许等待多久；
- 镜像、模型、Runtime Env 和编译需要多久；
- 模型源和网络能否承受并发冷启动；
- 网关如何返回排队、重试或降级；
- 是否有启动失败后的备用容量；
- 节点缓存消失会增加多少恢复时间。

## 11. 资源碎片与 Bin Packing

Autoscaler 会模拟资源放置，但业务仍可能制造碎片：

```text
Node A：剩余1 GPU
Node B：剩余1 GPU
新Actor：需要STRICT_PACK 2 GPU
结果：集群总剩余2 GPU，但不可调度
```

优化方式：

- 标准化资源形状；
- 单机 TP 使用匹配 GPU 数的 Node Type；
- 控制小 Actor 占用大 GPU 节点；
- 为长期服务与批任务分池；
- 观察 Reserved、Used 和 Pending，不只看总 GPU 数。

## 12. 云 Cluster Launcher

Cluster Launcher 使用 YAML、`ray up`、`ray down`、`ray exec` 和 `ray monitor` 管理 VM 集群：

```bash
ray up cluster.yaml
ray monitor cluster.yaml
ray exec cluster.yaml 'ray status'
ray down cluster.yaml
```

这些命令会创建、更新或删除外部资源。执行前必须审查 Provider、区域、网络、安全组、实例类型、磁盘、最大节点数和
成本。`ray up` 更新某些字段可能重建节点或重启 Ray 服务，不能把它当无影响的配置检查。

生产执行应通过代码评审、Plan/变更单、预算保护和回滚流程。

## 13. Autoscaler v1/v2 与版本边界

较新 Ray 版本持续演进 Autoscaler v2、标签和 Worker Group 能力。配置字段、默认行为和支持 Provider 可能变化。
部署时记录：

- Ray 版本；
- Autoscaler 代际/启用方式；
- Cluster Launcher 或 KubeRay 版本；
- Provider 插件版本；
- 完整 Cluster YAML/CR；
- 实例启动和停止日志。

不要从 `master` 文档复制字段到旧版集群。

## 14. KubeRay 中的扩缩容

KubeRay 使用 `workerGroupSpecs` 描述 Worker Group，Autoscaler 通常作为 Head Pod 中的独立容器运行。它根据 Ray
资源需求调整 Worker Pod 数，Kubernetes 再负责 Pod 调度和底层节点供应。

```text
Ray Autoscaler：需要几个Worker Pod
Kubernetes Scheduler：Pod放在哪个K8s Node
Cluster Autoscaler/Karpenter：是否需要新机器
云Provider：是否真的能创建实例
```

这是三到四层收敛链。Ray Pod Pending 的根因可能是 Kubernetes GPU、PVC、Taint、配额或云库存，不一定是 Ray。
下一阶段将单独展开。

## 15. 观测指标

- 各 Worker Group 当前、目标、Pending、失败节点数；
- 资源需求按 CPU/GPU/自定义资源分类；
- Placement Group Pending/Infeasible；
- 节点供应、Ray 加入、Runtime Env、模型 Ready 各阶段耗时；
- 扩容/缩容次数和抖动；
- 云 Provider 错误、配额和库存；
- 空闲资源、资源碎片和成本；
- 缩容导致的 Task/Actor/Object 重建；
- 入口队列、拒绝率和 SLO。

## 16. 故障实验

1. 提交一个可由现有 Node Type 满足的 Pending Task，验证扩容；
2. 提交一个没有任何 Node Type 能满足的 Bundle，验证 Infeasible 告警；
3. 将 GPU Worker Group 达到上限，验证入口限流；
4. 模拟镜像拉取慢和 Runtime Env 失败，分解 Ready 时间；
5. 保留 ObjectRef 或长期 Actor，验证节点不会错误缩容；
6. 释放工作，验证超过 Idle 窗口后缩容；
7. 在允许范围内模拟 Provider 配额不足，验证错误不会无限重试。

## 17. 常见错误

| 错误 | 后果 |
| --- | --- |
| 按 GPU 利用率期待 Ray 自动扩容 | 没有逻辑资源需求时不会产生正确扩容信号 |
| Worker Group 只写 GPU 数 | 型号、显存、拓扑和 NIC 可能不匹配 |
| 一开始就 Scale-to-zero | 首请求超时、冷启动风暴 |
| Idle 时间过短 | 节点反复创建销毁 |
| 无限提高 `max_workers` | 成本、配额、IP 和存储失控 |
| 忽略单 Bundle 形状 | 总资源足够仍永久 Pending |
| Head 承载大量业务 | 控制面资源被抢占 |
| 同时多层自动扩缩但没有时间线 | 无法判断由哪层阻塞 |

## 18. 生产验收

- [ ] 静态容量基线已经完成；
- [ ] 每种 Worker Group 的硬件、网络、镜像和资源已归档；
- [ ] Task/Actor/Placement Group 资源声明与真实使用一致；
- [ ] 最小/最大节点数符合 SLO、预算和配额；
- [ ] 冷启动每个阶段都有指标；
- [ ] Pending 与 Infeasible 能明确区分并告警；
- [ ] 缩容不会破坏 Actor、对象、Checkpoint 和服务容量；
- [ ] Head 资源与业务 Worker 隔离；
- [ ] Autoscaler/Provider 故障和回滚完成演练。

下一阶段：[Ray 学习路线：KubeRay](../00-Ray学习路线.md#6-第四阶段kuberay)。

## 19. 官方资料 {/* #官方资料 */}

- [Ray Cluster Key Concepts](https://docs.ray.io/en/latest/cluster/key-concepts.html)
- [Configuring Autoscaling](https://docs.ray.io/en/latest/cluster/vms/user-guides/configuring-autoscaling.html)
- [Cluster YAML Configuration](https://docs.ray.io/en/latest/cluster/vms/references/ray-cluster-configuration.html)
- [Cluster Launcher Commands](https://docs.ray.io/en/latest/cluster/vms/references/ray-cluster-cli.html)
- [Autoscaler v2 Internals](https://docs.ray.io/en/latest/ray-core/internals/autoscaler-v2.html)
