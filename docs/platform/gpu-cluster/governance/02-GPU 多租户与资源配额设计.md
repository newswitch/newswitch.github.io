---
title: GPU 多租户与资源配额设计
date: 2026-07-22 19:10:00
categories: 云原生
tags: ["Kubernetes", "多租户", "ResourceQuota", "Kueue", "ClusterQueue", "GPU", "学习路线"]
---

# GPU 多租户与资源配额设计

共享 GPU 集群能降本，但会带来 **安全、公平、嘈杂邻居** 问题。本文按 [Kubernetes 多租户](https://kubernetes.io/zh-cn/docs/concepts/security/multi-tenancy/) 搭隔离底座，再用 [Kueue ClusterQueue](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/cluster_queue/)（及已有 Volcano Queue）做 GPU 配额、借用与抢占。节点池见 [第 51 篇](./01-生产%20GPU%20集群节点池规划.md)，优先级见 [第 15 篇](../scheduling-sharing/03-GPU%20集群优先级与抢占策略.md)。

---

## 1. 多租户要解决什么

官方强调共享集群的挑战：**隔离、公平性、嘈杂邻居**。常见两类：

| 类型 | 谁是租户 | 典型手段 |
|------|----------|----------|
| **多团队** | 内部算法/平台组 | Namespace + RBAC + 配额 + 网络策略 |
| **多客户** | SaaS 终端客户 | 更强隔离（甚至独立集群） |

GPU 场景的嘈杂邻居：一人占满 H100、NCCL 打满网、或低优训练拖死推理。

隔离谱系从「软」（同集群 Namespace）到「硬」（独立集群/硬件）；本文聚焦 **共享集群内的软～中等隔离**。

---

## 2. Namespace 隔离（控制面）

Namespace 提供：

1. 名称隔离  
2. RBAC / NetworkPolicy / ResourceQuota 的作用域  

建议：

- **一团队一 Namespace**（或一关键工作负载一 Namespace）  
- RBAC 最小权限，禁止租户改集群级对象  
- NetworkPolicy：默认拒绝跨 ns，再按需放行（需 CNI 支持）  
- 存储用动态 PVC，避免 HostPath 互踩  

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: team-llm
  labels:
    tenant: team-llm
    research-cohort: ai-platform
```

---

## 3. ResourceQuota 与 LimitRange

配额是 Namespace 级「硬顶」，缓解嘈杂邻居、保护控制面（限制对象数量）。

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-llm-gpu
  namespace: team-llm
spec:
  hard:
    requests.nvidia.com/gpu: "8"
    limits.nvidia.com/gpu: "8"
    requests.cpu: "64"
    requests.memory: 256Gi
    pods: "40"
```

注意：

- 有配额时，容器通常必须写 **requests/limits**  
- 配额 **不区分** H100/T4（若都叫 `nvidia.com/gpu`）→ 用 **节点池 + Flavor** 或不同扩展资源名  
- 配额管不住网络带宽等；强隔离靠节点池/独立网  

LimitRange 可给默认 requests，避免有人漏写抢光节点。

---

## 4. Kueue：ClusterQueue / LocalQueue / 借用

[ClusterQueue](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/cluster_queue/)：集群级资源池账本，定义各 **ResourceFlavor** 的配额与公平规则。用户通过 Namespace 内 **LocalQueue** 提交 Job（`kueue.x-k8s.io/queue-name`）。

### 4.1 关键字段

| 字段 | 含义 |
|------|------|
| `nominalQuota` | 名义配额（「自己的」份额） |
| `borrowingLimit` | 最多能从 cohort 借多少 |
| `lendingLimit` | 最多借出多少给别人 |
| `cohort` | 同一队列组内可互借 |
| `namespaceSelector` | 哪些 Namespace 可准入 |

```yaml
apiVersion: kueue.x-k8s.io/v1beta2
kind: ClusterQueue
metadata:
  name: team-a-cq
spec:
  cohort: ai-cohort
  namespaceSelector:
    matchLabels:
      tenant: team-a
  resourceGroups:
    - coveredResources: ["cpu", "memory", "nvidia.com/gpu"]
      flavors:
        - name: h100-training
          resources:
            - name: nvidia.com/gpu
              nominalQuota: 16
              borrowingLimit: 8
            - name: cpu
              nominalQuota: 128
            - name: memory
              nominalQuota: 2Ti
---
apiVersion: kueue.x-k8s.io/v1beta2
kind: ClusterQueue
metadata:
  name: team-b-cq
spec:
  cohort: ai-cohort
  namespaceSelector:
    matchLabels:
      tenant: team-b
  resourceGroups:
    - coveredResources: ["cpu", "memory", "nvidia.com/gpu"]
      flavors:
        - name: h100-training
          resources:
            - name: nvidia.com/gpu
              nominalQuota: 16
              lendingLimit: 8
```

借用语义要点（官方）：

- 优先用自己的 `nominalQuota`  
- 不够且 cohort 有空闲时，可 **borrowing**（受 borrowingLimit / 对方 lendingLimit 约束）  
- 有待办时，优先保证各方名义配额被「自己人」用上  

### 4.2 抢占（队列层）

ClusterQueue 可配：

- `preemption.reclaimWithinCohort`：回收 cohort 内超用配额  
- `borrowWithinCohort`：为了借用是否抢别人  

与 PriorityClass 配合：高优 Workload 更易在借用竞争中胜出（见官方 Fair Sharing / priority 相关说明）。

### 4.3 和 Volcano Queue

| | ResourceQuota | Volcano Queue | Kueue ClusterQueue |
|--|---------------|---------------|-------------------|
| 作用点 | 已创建对象的硬限 | 调度时队列配额 | **准入前**配额与 Flavor |
| Gang | 无 | 强 | WaitForPodsReady 等 |
| 型号 | 弱 | 扩展资源 | ResourceFlavor 一等公民 |
| 借用 | 无 | reclaim/weight | cohort 借用 |

可组合：RQ 防失控 + Kueue/Volcano 做公平排队；选一个作为批处理主账本，避免双重扣减逻辑不清。

---

## 5. 推荐租户蓝图（GPU）

```text
Namespace team-* 
  ├─ ResourceQuota（GPU/CPU/Pod 硬顶）
  ├─ NetworkPolicy（默认拒绝跨租户）
  ├─ LimitRange
  └─ LocalQueue → ClusterQueue（按团队）
         └─ Flavor：h100-training / a100-inference / t4-shared

节点池（污点）+ PriorityClass（推理>训练>开发）
```

推理线上服务：可只走 Deployment + 推理池，不强制进 Kueue；训练/批推理进队列。

---

## 6. 嘈杂邻居对策一览

| 问题 | 手段 |
|------|------|
| 超用 GPU | RQ + ClusterQueue nominalQuota |
| 错型号 | Flavor / 节点标签 |
| 训练挤推理 | 节点池隔离 + PriorityClass |
| 跨租户打网 | NetworkPolicy / 独立 CNI 策略 |
| 借用不还 | lendingLimit + reclaim 抢占 |
| 半组占卡 | Gang / WaitForPodsReady |

---

## 7. 小结

| 层 | 工具 |
|----|------|
| API 隔离 | Namespace + RBAC |
| 硬顶 | ResourceQuota |
| 型号与借用 | Kueue Flavor + ClusterQueue + Cohort |
| 运行优先级 | PriorityClass + 队列抢占 |
| 物理边界 | 节点池污点 |

下一篇：[容量规划](./03-GPU%20集群容量规划方法.md)。

---

## 参考与致谢

- [多租户 \| Kubernetes](https://kubernetes.io/zh-cn/docs/concepts/security/multi-tenancy/)  
- [ClusterQueue](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/cluster_queue/)  
- [ResourceFlavor](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/resource_flavor/)  
- [拓扑感知调度](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/topology_aware_scheduling/)  

本文以官方多租户与 Kueue 概念为准，映射到 GPU 共享集群落地。
