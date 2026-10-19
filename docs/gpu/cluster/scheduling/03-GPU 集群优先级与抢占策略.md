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
- **PDB**：约束支持 Eviction API 的自愿中断；调度器抢占对 PDB 的遵守是尽力而为，不能把它当作绝对防抢占锁

## 3. 抢占时会发生什么

1. 高优 Pod Pending，且没有足够空闲 GPU
2. 调度器选中可牺牲的低优 Pod（同节点上能腾出资源）
3. 低优 Pod 收到优雅终止（`terminationGracePeriodSeconds`）
4. 资源释放后高优 Pod 绑定

生产注意：

- 训练被抢应能从 **Checkpoint** 恢复（[第 32 篇](../../../ai-systems/training/distributed/04-训练任务%20Checkpoint%20与断点恢复.md)）
- `preemptionPolicy: Never` 表示该 Pod 不主动抢占低优先级 Pod；它仍可能被更高优先级 Pod 抢占，也可能遭遇驱逐或节点故障。不能用它保证自身不抖动
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
| 抢占代价？ | 训练要 CKPT；推理需容量余量和恢复策略，PDB/Never 不提供绝对保护 |
| 和队列？ | PriorityClass 管 Pod；Queue 管配额与批作业 |

## 7. 准入与放置不是同一个决策

ResourceQuota 判断 Namespace 是否还能申请资源；Kueue 等队列层判断工作负载是否得到预算；kube-scheduler 决定 Pod 能放到哪台节点。即使前两项通过，节点型号、污点、亲和、存储和拓扑仍可能使 Pod Pending。

教学例子：两节点各 4 GPU，各有两个低优先级单卡 Pod，集群剩 4 GPU。高优先级 Pod 请求单节点 4 GPU，可能需要在同一节点腾出两张卡；“总空闲 4”不足以满足放置。若它还有节点亲和，只能选择目标节点上的候选者，不能无条件驱逐别处 Pod 来解决。

## 8. 抢占不保证立即运行

候选者终止存在宽限期；其他资源可能在等待期间变化；提名节点也不等于最终绑定节点。排障应分别看 Pending Reason、候选驱逐事件、终止宽限期与绑定事件。优先级主要影响排队和抢占，不提高 GPU 计算速度，也不绕过不满足的亲和条件。

把在线服务、可恢复训练和开发任务分层只是策略起点。在线服务还应具备多副本、容量余量、流量摘除与模型重载预算；可恢复训练要能区分完整和未完成 Checkpoint；队列回收应明确哪些任务可被停止，防止多个调度层相互竞争同一份资源所有权。

## 9. 掌握检查

高优先级 Pod 设置 Never，为什么仍然 Pending？它不会主动腾走其他 Pod，且优先级不创造资源。为什么设置 PDB 仍可能中断？PDB 不是所有终止路径的强制屏障。回答时还应区分调度抢占、节点压力驱逐、管理员删除与节点故障。

## 10. 参考与致谢 {/* #参考与致谢 */}

- [Kubernetes 调度 · Pod 优先级与抢占](https://kubernetes.io/zh-cn/docs/concepts/scheduling-eviction/pod-priority-preemption/)
- [多租户](https://kubernetes.io/zh-cn/docs/concepts/security/multi-tenancy/)
- [Kueue ClusterQueue · 抢占](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/cluster_queue/)

本文聚焦 GPU 场景的优先级分层，并与队列抢占做边界划分。
