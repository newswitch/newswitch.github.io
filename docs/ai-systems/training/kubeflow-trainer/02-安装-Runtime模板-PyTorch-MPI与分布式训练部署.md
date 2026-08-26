---
title: "Kubeflow Trainer 安装、Runtime 模板、PyTorch、MPI 与分布式训练部署"
sidebar_label: "02. 安装与分布式部署"
sidebar_position: 2
description: "从 CRD 和 Controller 验证开始，构建可复用 Runtime，并掌握 PyTorch 与 MPI 任务的进程、网络、存储和设备边界。"
tags: [Kubeflow Trainer, PyTorch, MPI, Runtime, Kubernetes]
---

# Kubeflow Trainer 安装、Runtime 模板、PyTorch、MPI 与分布式训练部署

本文重点不是记住某个版本的安装命令，而是建立一套版本可验证、对象可追踪、训练可复现的部署方法。Kubeflow Trainer V2 仍在演进，安装清单和字段应以目标版本官方文档及集群 CRD 为准。

## 1. 安装前提

| 依赖 | 验证目标 |
| --- | --- |
| Kubernetes | API Server、DNS、ServiceAccount 和准入策略正常 |
| JobSet | Trainer 能创建和观察底层多角色作业 |
| GPU/NPU 设备插件 | 节点 Capacity/Allocatable 能看到扩展资源 |
| 容器运行时 | 驱动和用户态 Runtime 能注入容器 |
| CNI | 所有训练 Pod 间端口可达，MTU 一致 |
| CSI/对象存储 | 数据和 Checkpoint 能读写，权限明确 |
| 调度器 | 默认调度或 Kueue/Volcano 等集成已确认 |

不要从训练 YAML 开始排查一个尚未健康的底座。先确认节点、设备、DNS、存储和最小 GPU/NPU Pod。

## 2. 安装后的四层验收

### 2.1 API 层

```bash
kubectl api-resources --api-group=trainer.kubeflow.org
kubectl get crd | grep -E 'trainer.kubeflow.org|jobset.x-k8s.io'
kubectl explain trainjob.spec
```

目标是确认当前集群真正支持的 Kind、Version 和字段。客户端示例与 CRD 不匹配时，请求通常在 API 校验阶段就被拒绝。

### 2.2 控制器层

```bash
kubectl get deploy,pod -A | grep -E 'trainer|jobset'
kubectl logs -n <controller-namespace> deploy/<trainer-controller> --tail=200
kubectl logs -n <jobset-namespace> deploy/<jobset-controller> --tail=200
```

控制器 Pod Running 仍不等于可用，还要检查 Leader Election、RBAC、Webhook 证书、Watch 权限和持续 Reconcile 错误。

### 2.3 Runtime 层

```bash
kubectl get trainingruntime -A
kubectl get clustertrainingruntime
kubectl describe clustertrainingruntime <runtime-name>
```

确认目标 Runtime 存在、引用名正确、镜像可访问，并记录 Runtime 的 API 版本与变更方式。

### 2.4 最小任务层

先运行只输出主机名、环境变量和设备数量的最小分布式程序，再运行真实模型。这样可以把基础设施问题与模型代码问题分离。

## 3. Runtime 模板设计

一套生产 Runtime 至少明确以下内容：

- 训练框架和 Launcher；
- 基础镜像及不可变 Digest；
- 主容器命令、端口和环境变量；
- `/dev/shm`、模型、数据和 Checkpoint Volume；
- CPU、内存、GPU/NPU 的 Request/Limit；
- 节点选择、污点容忍和拓扑约束；
- ServiceAccount、安全上下文和网络策略；
- 可覆盖字段以及默认副本数。

建议按平台与硬件兼容矩阵创建版本化 Runtime，例如：

```text
pytorch-cuda12-torch26-v1
pytorch-cann8-torch-npu-v1
mpi-cuda12-nccl-v1
```

名字应表达兼容边界，不要用含义会漂移的 `latest-runtime`。

## 4. PyTorch 任务如何变成 Rank

假设使用 2 个节点、每节点 8 张 GPU：

```text
nnodes = 2
nproc_per_node = 8
world_size = 16
global_rank = node_rank × 8 + local_rank
```

每个 Pod 可以启动一个 `torchrun`，再派生 8 个训练进程；也可以采用每 Pod 单进程，具体由 Runtime 定义。两者对 Pod 数量、故障粒度、CPU 配额和日志采集方式不同。

训练程序仍需正确处理：

```python
import os
import torch
import torch.distributed as dist

dist.init_process_group(backend="nccl")
local_rank = int(os.environ["LOCAL_RANK"])
torch.cuda.set_device(local_rank)

print(
    "rank=", dist.get_rank(),
    "world_size=", dist.get_world_size(),
    "device=", torch.cuda.current_device(),
)
```

Trainer 能提供启动环境，却不能修复脚本中错误的 Device 绑定、Backend、Sampler 或只在 Rank 0 保存 Checkpoint 的逻辑。

### 4.1 启动前必须一致的变量

- 所有节点使用相同代码与依赖；
- `MASTER_ADDR` 和 `MASTER_PORT` 可达；
- `WORLD_SIZE`、Node Rank 与进程数一致；
- 每个本地进程绑定唯一 GPU/NPU；
- NCCL/HCCL 选择到正确网卡；
- 容器 IPC 和共享内存满足 DataLoader/通信需求。

## 5. MPI 任务的技术路径

MPI Runtime 常见路径是：

```text
Launcher Pod
→ 解析Worker主机与Slot
→ mpirun建立控制连接
→ 在Worker启动训练进程
→ MPI/NCCL执行通信
```

要分别验证 SSH/PMIx 等启动控制面与训练数据面。`mpirun` 无法启动远端进程，不代表 RDMA 一定故障；反之，进程能启动也不代表 NCCL 集合通信正常。

关键检查包括：

- Host 列表和 Slot 数是否与资源一致；
- Launcher 到 Worker 的名称解析与端口；
- 用户 UID、工作目录、代码和密钥权限；
- MPI 实现、UCX、NCCL/CUDA 或 HCCL/CANN 版本；
- 网卡、GID、RDMA Device 与 NUMA 拓扑；
- Root 容器相关参数是否仅在受控环境使用。

## 6. 数据、模型与 Checkpoint

训练 Pod 启动成功后，最常见的非计算瓶颈来自数据路径：

```text
对象存储 / CephFS / NFS
→ 节点网络
→ CSI挂载或下载器
→ 页缓存 / 本地NVMe缓存
→ DataLoader Worker
→ Pinned Memory
→ H2D
```

Runtime 可以统一挂载和初始化方式，但必须定义所有权：

- 数据集是只读挂载还是下载到本地缓存；
- 多 Rank 是否重复下载同一文件；
- Checkpoint 临时文件如何原子发布；
- Job 重试时是否覆盖已有 Checkpoint；
- World Size 改变后能否重新分片恢复；
- 凭据是 Pod 身份、Secret 还是节点身份。

## 7. 设备与拓扑

Kubernetes 只根据扩展资源数量分配设备时，不一定自动满足 NVLink、NIC 和 NUMA 最优位置。多机训练还应结合：

- Node Feature Discovery 或 GPU Feature Discovery 标签；
- PodAffinity、TopologySpreadConstraints；
- 调度器的网络拓扑能力；
- CPU Manager、Topology Manager；
- Multus/RDMA Device Plugin；
- `CUDA_VISIBLE_DEVICES` 或 Ascend 设备可见性与 Local Rank。

如果 TP/高频 Collective Rank 被放到慢互联，Trainer 对象仍可能全部 Running，但 Step Time 会显著恶化。

## 8. 最小验收矩阵

| 实验 | 证明什么 |
| --- | --- |
| 单节点单卡 | 镜像、代码、设备 Runtime 正常 |
| 单节点多卡 | 本机 Rank、NVLink/PCIe 与 Collective 正常 |
| 两节点最小 AllReduce | DNS、端口、NIC、NCCL/HCCL 正常 |
| 小数据训练若干 Step | DataLoader、Forward/Backward、Optimizer 正常 |
| 保存与恢复 Checkpoint | 存储语义和恢复逻辑正常 |
| 杀死一个 Worker | 失败传播、重试与终止策略符合预期 |

每扩大一个维度都保留上一层基线，否则多机失败时无法判断是模型、框架、网络还是调度问题。

参考：[Kubeflow Trainer Runtime Guide](https://trainer.kubeflow.org/en/latest/operator-guides/runtime.html)、[Kubeflow Trainer Examples](https://trainer.kubeflow.org/en/latest/examples/)。
