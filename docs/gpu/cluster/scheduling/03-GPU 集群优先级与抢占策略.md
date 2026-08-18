---
title: "GPU 集群优先级与抢占策略"
sidebar_label: "03. GPU 集群优先级与抢占策略"
sidebar_position: 3
description: "GPU 不够时，谁先跑、谁可以挤掉谁，决定 SLA。Kubernetes 用 PriorityClass 做 Pod 优先级与抢占；批处理队列（Volcano / Kueue）还有各自的抢占语义。本文说明原生层怎么配，以及和队列层怎么分工。多租户总览见 第 52 篇；Volcano 见 16～18。"
tags: ["Kubernetes", "PriorityClass", "抢占", "GPU", "学习路线"]
date: 2026-07-22 19:00:00
categories: 云原生
---

# GPU 集群优先级与抢占策略

GPU 不够时，谁先跑、谁可以挤掉谁，决定 SLA。Kubernetes 用 **PriorityClass** 做 Pod 优先级与抢占；批处理队列（Volcano / Kueue）还有各自的抢占语义。本文说明原生层怎么配，以及和队列层怎么分工。多租户总览见 [第 52 篇](../governance/02-GPU%20多租户与资源配额设计.md)；Volcano 见 [16～18](./04-Volcano%20GPU%20调度器入门.md)。

## 1. PriorityClass 是什么

`PriorityClass` 是集群级对象，给 Pod 一个整数优先级。调度器在资源紧张时：

1. 优先调度高优先级 Pending Pod
2. 必要时 **抢占**（驱逐）低优先级 Running Pod，为高优先级腾出资源

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: gpu-inference
value: 100000
globalDefault: false
description: "在线推理，可抢占训练/开发"
preemptionPolicy: PreemptLowerPriority   # 或 Never
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: gpu-training
value: 50000
description: "训练，可被推理抢占"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: gpu-dev
value: 10000
description: "开发调试，最易被抢"
```

Pod 引用：

```yaml
spec:
  priorityClassName: gpu-inference
  containers:
    - name: vllm
      resources:
        limits:
          nvidia.com/gpu: "1"
```

注意：`system-cluster-critical` / `system-node-critical` 等系统级优先级留给控制面组件，业务勿滥用。

## 2. 推理 / 训练 / 开发分层（推荐）

| 层级 | PriorityClass | 典型负载 | 被抢占？ |
|------|---------------|----------|----------|
| 高 | `gpu-inference` | 在线 vLLM、关键 API | 尽量不 |
| 中 | `gpu-training` | 分布式训练 Job | 可被推理挤 |
| 低 | `gpu-dev` | Notebook、实验 | 最先让路 |

配合：

- **节点池污点**：推理池只收高优先级 + 对应 toleration（[第 51 篇](../governance/01-生产%20GPU%20集群节点池规划.md)）
- **ResourceQuota**：限制低优先级租户的 GPU 上限（[第 52 篇](../governance/02-GPU%20多租户与资源配额设计.md)）
- **PDB**：关键推理设 `minAvailable`，降低被随意驱逐的风险

## 3. 抢占时会发生什么

1. 高优 Pod Pending，且没有足够空闲 GPU
2. 调度器选中可牺牲的低优 Pod（同节点上能腾出资源）
3. 低优 Pod 收到优雅终止（`terminationGracePeriodSeconds`）
4. 资源释放后高优 Pod 绑定

生产注意：

- 训练被抢应能从 **Checkpoint** 恢复（[第 32 篇](../../../ai-systems/training/distributed/04-训练任务%20Checkpoint%20与断点恢复.md)）
- 推理若 `preemptionPolicy: Never`，则宁可 Pending 也不挤别人——适合「绝对不能抖」的业务，但可能长期等不到卡
- 抢占 **不等于** 队列里的 reclaim；Volcano/Kueue 还有跨队列回收

## 4. 和 Volcano / Kueue 的分工

| 机制 | 作用域 | 典型用途 |
|------|--------|----------|
| PriorityClass | 单集群 kube-scheduler 抢占 | 推理挤开发 Pod |
| Volcano preempt / reclaim | 队列内 / 队列间 | 训练队列公平、Gang 作业 |
| Kueue preemption | Cohort / ClusterQueue 准入层 | 借配额后的回收、高优作业准入 |

实践建议：

- **在线 Deployment**：PriorityClass + 推理节点池
- **批训练 Job**：进 Volcano Queue 或 Kueue LocalQueue，再配 Workload 优先级
- 避免三套策略互相打架：先定「谁可以挤谁」的总表，再映射到具体对象

Kueue 侧示例字段（详见官方 ClusterQueue）：`preemption.reclaimWithinCohort`、`borrowWithinCohort`。

## 5. 验证

```bash
kubectl get priorityclass
kubectl describe pod <high>   # 看 Priority
# 占满 GPU 后提交高优 Pod，观察低优是否 Terminating
kubectl get events -A --field-selector reason=Preempted
```

## 6. 小结

| 问题 | 要点 |
|------|------|
| 怎么分层？ | 推理 > 训练 > 开发 |
| 抢占代价？ | 训练要 CKPT；推理要 PDB/Never 权衡 |
| 和队列？ | PriorityClass 管 Pod；Queue 管配额与批作业 |

## 7. 参考与致谢 {/* #参考与致谢 */}

- [Kubernetes 调度 · Pod 优先级与抢占](https://kubernetes.io/zh-cn/docs/concepts/scheduling-eviction/pod-priority-preemption/)
- [多租户](https://kubernetes.io/zh-cn/docs/concepts/security/multi-tenancy/)
- [Kueue ClusterQueue · 抢占](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/cluster_queue/)

本文聚焦 GPU 场景的优先级分层，并与队列抢占做边界划分。
