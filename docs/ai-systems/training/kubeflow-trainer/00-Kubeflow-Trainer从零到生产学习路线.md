---
title: "Kubeflow Trainer 从零到生产学习路线"
sidebar_label: "00. Kubeflow Trainer 学习路线"
sidebar_position: 0
description: "从 TrainJob、TrainingRuntime 和 MLPolicy 开始，掌握 Kubeflow Trainer V2 的控制面、分布式启动、调度、可观测性与故障定位。"
tags: [Kubeflow Trainer, TrainJob, TrainingRuntime, JobSet, 分布式训练]
---

# Kubeflow Trainer 从零到生产学习路线

Kubeflow Trainer 不是训练框架，也不负责实现梯度同步。它位于 Kubernetes 控制面，把“使用什么训练运行时、需要多少节点、每个节点多少资源、如何启动进程”转换成可调度和可观察的 Kubernetes 工作负载。

```text
训练代码与参数
  ↓
TrainJob：本次训练的意图
  ↓ 引用
TrainingRuntime / ClusterTrainingRuntime：可复用的运行模板
  ↓ Controller Reconcile
JobSet / Job / Pod：真正运行的资源
  ↓
torchrun / mpirun / 训练框架
  ↓
NCCL / HCCL / 存储 / Checkpoint
```

## 1. 先区分 Trainer V1 与 V2

网上许多资料仍使用 `PyTorchJob`、`TFJob`、`MPIJob` 等框架专用 CRD，这是 Trainer V1 的对象模型。Trainer V2 使用统一的 `TrainJob` 表达训练任务，通过 `TrainingRuntime` 或集群级 `ClusterTrainingRuntime` 描述运行模板，并由 `MLPolicy` 注入不同框架所需的分布式语义。

| 维度 | Trainer V1 | Trainer V2 |
| --- | --- | --- |
| 用户对象 | PyTorchJob、TFJob、MPIJob 等 | TrainJob |
| 运行模板 | 分散在各类 CRD Spec 中 | TrainingRuntime / ClusterTrainingRuntime |
| 框架适配 | 各控制器分别实现 | MLPolicy，例如 Torch、MPI |
| 底层编排 | 各自创建工作负载 | 以 JobSet 等 Kubernetes API 组合资源 |
| 复用方式 | 复制 Job YAML | 平台维护 Runtime，用户只提交差异 |

V2 API 仍可能处于 `v1alpha1`。学习时不要仅凭文章复制 YAML，应先检查集群实际安装的 CRD、字段和控制器版本：

```bash
kubectl api-resources --api-group=trainer.kubeflow.org
kubectl explain trainjob --recursive
kubectl get crd | grep trainer.kubeflow.org
```

## 2. 推荐学习顺序

1. [TrainJob、TrainingRuntime、MLPolicy、JobSet 与协调路径](./01-TrainJob-TrainingRuntime-MLPolicy-JobSet与协调路径.md)：先理解 API 对象和控制器边界；
2. [安装、Runtime 模板、PyTorch、MPI 与分布式训练部署](./02-安装-Runtime模板-PyTorch-MPI与分布式训练部署.md)：把声明转换成真实 Rank；
3. [Kueue、Volcano、Gang 调度、可观测性与故障排查](./03-Kueue-Volcano-Gang-调度-可观测性与故障排查.md)：从准入、调度、Pod 到训练进程逐层定位。

建议同时学习：

- [Kubernetes 分布式训练基础](../distributed/01-Kubernetes%20分布式训练基础.md)，理解 Rank、Rendezvous 和 Worker；
- [NCCL 通信原理与常见问题](../distributed/05-NCCL%20通信原理与常见问题.md)，理解训练 Pod 启动之后发生的集合通信；
- [Kueue 队列、GPU 配额与工作负载准入](../../../gpu/cluster/scheduling/13-Kueue队列配额与工作负载准入.md)，理解“已创建但尚未获得资源”的状态。

## 3. 三层责任边界

| 层级 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Trainer 控制面 | API 默认值、模板实例化、角色与副本编排、状态汇总 | 梯度算法和 GPU Kernel |
| Kubernetes 与调度器 | 配额、准入、放置、容器生命周期、故障重建 | 模型是否收敛 |
| 训练框架 | Rank 初始化、Forward/Backward、Collective、Checkpoint | 集群公平共享和 Pod 调度 |

排障时如果不先判断问题属于哪一层，很容易把 Pending Pod 当作 NCCL 问题，或把训练脚本异常归因于 Trainer Controller。

## 4. 完成标准

- 能解释 TrainJob 如何引用 Runtime，并追踪到 JobSet、Job 和 Pod；
- 能说明 Torch 与 MPI Policy 如何建立 Rank 和启动命令；
- 能设计平台维护的 Runtime，而不让业务方复制大量基础设施 YAML；
- 能区分资源准入、Gang 调度、镜像与存储、Rendezvous、Collective 五类故障；
- 能从 TrainJob Condition 找到第一个失败对象和第一个失败 Rank；
- 能说明 Trainer、FSDP2/Megatron、Kueue/Volcano、NCCL/HCCL 之间的边界。

参考：[Kubeflow Trainer Operator Guides](https://trainer.kubeflow.org/en/latest/operator-guides/)、[V1 到 V2 迁移说明](https://trainer.kubeflow.org/en/latest/operator-guides/migration.html)。
