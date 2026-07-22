---
title: Volcano Queue 与 GPU 配额管理
date: 2026-07-22 16:55:00
categories: 云原生
tags: ["Kubernetes", "Volcano", "Queue", "GPU", "多租户", "学习路线"]
---

# Volcano Queue 与 GPU 配额管理

Queue 是 Volcano 多租户资源分配与任务调度的核心。通过队列可以做配额、优先级、抢占与回收，提高 GPU / CPU 等资源利用率。本文整理自官方 [Queue Resource Management](https://volcano.sh/docs/v1.15.0/keyfeatures/queueresourcemanagement/) 与 [层级队列](https://volcano.sh/zh-hans/docs/keyfeatures/hierarchicalqueue/)，前置阅读：[Volcano 调度器入门](./16-Volcano%20GPU%20调度器入门.md)。

---

## 1. 队列能解决什么

| 诉求 | Queue 怎么帮 |
|------|----------------|
| 多租户隔离 | 按队列限制用量上限 |
| 公平 / 比例 | weight 或 deserved 划分「应得」份额 |
| 忙时借用 | 空闲时可超过 deserved |
| 紧时回收 | reclaim 收回超出应得的部分 |
| 关键任务 | 队列内 preempt；跨队列 reclaim |

GPU 只是扩展资源的一种：在 `capability` / `deserved` / `guarantee` 里写 `nvidia.com/gpu` 即可（资源名以集群实际为准）。

---

## 2. 三级资源配置

官方推荐关系：

```text
guarantee ≤ deserved ≤ capability
```

| 字段 | 含义 |
|------|------|
| **capability** | 队列用量**上限** |
| **deserved** | **应得**量。无竞争时可超额使用；多队列争用且资源紧张时，超出 deserved 的部分可被回收 |
| **guarantee** | **预留**量，只给本队列，别人借不走 |

注意：

1. 启用 **capacity** 插件时，一般需要配置 `deserved`  
2. 同级队列场景：各队列 `deserved` 之和宜约等于集群该维度总量  
3. 层级队列：子队列 `deserved`/`guarantee` 之和不超过父队列；子队列 `capability` 不超过父队列；未设则继承父 / 祖先 / root  
4. 集群自动扩缩（Cluster Autoscaler / Karpenter）时总量会变：capacity 插件可能要手动调 deserved；proportion 可按权重自动重算  

---

## 3. 两个互斥插件：capacity vs proportion

**二者不能同时启用。** Volcano v1.9.0 之后更推荐 **capacity**（直观配应得量）。

### 3.1 capacity：显式 deserved

```yaml
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: capacity-queue
spec:
  deserved:
    cpu: "10"
    memory: "20Gi"
    nvidia.com/gpu: "4"
  capability:
    cpu: "20"
    memory: "40Gi"
    nvidia.com/gpu: "8"
```

### 3.2 proportion：用 weight 算 deserved

```yaml
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: proportion-queue
spec:
  weight: 1
  capability:
    cpu: "20"
    memory: "40Gi"
    nvidia.com/gpu: "8"
```

当集群总量为 `total_resource` 时：

```text
queue_deserved = (queue_weight / total_weight) * total_resource
```

若算出的 deserved 大于队列内待调度 PodGroup 总需求，最终 deserved 会收到「总需求」上，避免过度预留。

---

## 4. 与队列相关的 Action

| Action | 范围 | 作用 |
|--------|------|------|
| enqueue | 入队准入 | 按配额与当前用量决定是否允许新 Job 入队 |
| allocate | 分配 | 在配额内分配，并支持队列间借用空闲资源 |
| preempt | **队列内** | 高优先级抢低优先级 |
| reclaim | **队列间** | 资源紧时优先收回超出 deserved 的用量 |

再次提醒：enqueue 与 reclaim/preempt 组合时要小心冲突。

调度器配置示例（扁平队列 + proportion）：

```yaml
actions: "enqueue, allocate, backfill"
tiers:
- plugins:
  - name: priority
  - name: gang
  - name: conformance
- plugins:
  - name: drf
  - name: predicates
  - name: proportion
  - name: nodeorder
  - name: binpack
```

---

## 5. 回收机制示例（官方四步）

假设集群共 4 CPU：

1. **初始**：default 队列暂用全部 4C  
2. **default 上跑 job1=1C、job2=3C**：可暂时超过「应得」  
3. **新建 test 队列**：capacity 设 `deserved.cpu: 3`，或 proportion 设 `weight: 3`（相对 default=1）且 `reclaimable: true`  
4. **test 上提交 job3=3C**：系统从 default **回收超出应得** 的资源 → 驱逐 job2(3C)，保留 job1(1C)，job3 运行  

GPU 同理：把 CPU 换成 `nvidia.com/gpu` 即可理解「训练队列借推理队列空闲卡，推理一忙就收回」。

---

## 6. 层级队列

扁平队列不够时，可用 **parent** 建树（类似 YARN Capacity Scheduler），便于部门 / 业务线分层配额。

### 6.1 调度器配置

层级能力建在 **capacity** 插件上，需：

- 启用 `capacity`，`enableHierarchy: true`  
- 启用 `reclaim`  

```yaml
kind: ConfigMap
apiVersion: v1
metadata:
  name: volcano-scheduler-configmap
  namespace: volcano-system
data:
  volcano-scheduler.conf: |
    actions: "allocate, preempt, reclaim"
    tiers:
    - plugins:
      - name: priority
      - name: gang
        enablePreemptable: false
    - plugins:
      - name: drf
        enablePreemptable: false
      - name: predicates
      - name: capacity
        enableHierarchy: true
      - name: nodeorder
```

### 6.2 构建队列树

Scheduler 启动时会自动有 **root**。用户基于 root 建子队列，例如：

```text
root
├── child-queue-a
│   ├── subchild-queue-a1
│   └── subchild-queue-a2
└── child-queue-b
```

```yaml
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: child-queue-a
spec:
  reclaimable: true
  parent: root
  deserved:
    cpu: 64
    memory: 128Gi
    nvidia.com/gpu: "8"
---
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: subchild-queue-a1
spec:
  reclaimable: true
  parent: child-queue-a
  deserved:
    cpu: 32
    memory: 64Gi
    nvidia.com/gpu: "4"
```

作业提交到叶子队列：

```yaml
apiVersion: batch.volcano.sh/v1alpha1
kind: Job
metadata:
  name: job-a
spec:
  queue: subchild-queue-a1
  schedulerName: volcano
  minAvailable: 1
  tasks:
    - replicas: 1
      name: test
      template:
        spec:
          containers:
            - name: alpine
              image: alpine
              command: ["/bin/sh", "-c", "sleep 1000"]
              resources:
                requests:
                  cpu: "1"
                  memory: 2Gi
```

回收顺序概念：优先收**兄弟队列**中超出 deserved 的任务；不够再沿祖先向上找。

约束：

- 当前版本一般只能往 **叶子队列** 交作业  
- 若已有任务提交到某队列，通常不能再在其下建子队列  
- 子队列 deserved/guarantee 之和 ≤ 父；capability ≤ 父；未设则继承  

---

## 7. GPU 场景三队列设计示例

结合本系列学习目标，可用 proportion 先搭扁平模型：

```yaml
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: production
spec:
  weight: 10
  capability:
    nvidia.com/gpu: "16"
  reclaimable: false
---
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: training
spec:
  weight: 5
  capability:
    nvidia.com/gpu: "16"
  reclaimable: true
---
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: development
spec:
  weight: 1
  capability:
    nvidia.com/gpu: "8"
  reclaimable: true
```

策略意图：

- **production**：推理，权重高，尽量不被 reclaim  
- **training**：可借用空闲卡，忙时可能被收  
- **development**：权重低，最易让路  

更精细时用 capacity + 显式 `deserved`，或上层级队列按事业部拆分。

---

## 8. 小结

| 主题 | 要点 |
|------|------|
| 三级配额 | guarantee ≤ deserved ≤ capability |
| capacity / proportion | 互斥；一个配应得量，一个配权重 |
| reclaim / preempt | 跨队列回收 vs 队列内抢占 |
| 层级队列 | parent + capacity.enableHierarchy；只往叶子交 Job |
| GPU | 把 `nvidia.com/gpu` 写进三级字段即可纳入同一套账本 |

下一篇：[Gang Scheduling 在分布式训练中的作用](./18-Gang%20Scheduling%20在分布式训练中的作用.md)。

---

## 参考与致谢

- [Queue Resource Management](https://volcano.sh/docs/v1.15.0/keyfeatures/queueresourcemanagement/)  
- [层级队列](https://volcano.sh/zh-hans/docs/keyfeatures/hierarchicalqueue/)  

本文基于上述 Volcano 官方文档整理，并补充了 GPU 三队列示例。
