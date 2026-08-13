---
title: Volcano GPU 调度器入门
date: 2026-07-22 16:50:00
categories: 云原生
tags: ["Kubernetes", "Volcano", "GPU", "调度", "Gang", "学习路线"]
---

# Volcano GPU 调度器入门

[Volcano](https://volcano.sh/zh-hans/) 是基于 Kubernetes 的高性能批处理 / AI 工作负载调度引擎（CNCF 孵化项目）。默认 kube-scheduler 更擅长通用服务；训练、大数据、MPI 等「一组 Pod 要一起跑」的场景，常用 Volcano 补齐 **Gang、队列配额、公平共享、异构设备** 等能力。

本文整理自官方 [调度器介绍](https://volcano.sh/zh-hans/docs/scheduler/overview/) 与 [统一调度](https://volcano.sh/zh-hans/docs/v1.11.0/keyfeatures/unifiedscheduling/)，作为本系列 Volcano 三篇的总览。队列细节见 [Queue 与 GPU 配额](./05-Volcano%20Queue%20与%20GPU%20配额管理.md)，Gang 细节见 [Gang Scheduling](./06-Gang%20Scheduling%20在分布式训练中的作用.md)。

---

## 1. 为什么需要 Volcano

相对默认调度器，Volcano 常见价值：

| 能力 | 说明 |
|------|------|
| 统一调度 | 可调度 VcJob，也可调度 Deployment / StatefulSet 等原生负载（`schedulerName: volcano`） |
| 批处理 / AI | 对接 TensorFlow、PyTorch、Ray、Spark、Flink、MPI 等 |
| 队列 | 多租户配额、借用、回收、优先级 |
| Gang | 「凑齐再开跑」，避免只起一半 Worker 占住 GPU |
| 异构设备 | GPU / NPU 等扩展资源与拓扑相关策略 |
| 策略插件 | DRF、Binpack、Proportion / Capacity、NUMA aware 等 |

对 GPU 集群而言：Device Plugin 解决「卡怎么暴露」；Volcano 解决「多租户、训练作业怎么排、怎么整组启动」。

---

## 2. Scheduler 组成：Action + Plugin

Volcano Scheduler 由一系列 **action** 与 **plugin** 组成：

- **action**：调度周期里要执行的步骤（做什么）  
- **plugin**：各步骤里算法的具体实现（怎么做）  

可扩展：可按需启用 / 自研 action、plugin。

### 2.1 工作流

典型周期：

1. 客户端提交的 Job 被 scheduler 观察并缓存  
2. 周期性开启会话（一个调度周期）  
3. 未调度 Job 进入待调度队列  
4. 按配置顺序执行 `enqueue`、`allocate`、`preempt`、`reclaim`、`backfill` 等，为 Job 找节点并绑定；具体算法由已注册 plugin 提供  
5. 关闭本次会话  

官方工作流示意见文档：[调度器介绍 · 工作流](https://volcano.sh/zh-hans/docs/scheduler/overview/)。

### 2.2 Actions

| Action | 作用 |
|--------|------|
| **enqueue** | 过滤后把任务送入待调度队列；状态 pending → inqueue |
| **allocate** | 预选 / 优选，选出最合适节点并分配 |
| **preempt** | 同队列内按优先级抢占 |
| **reclaim** | 新任务入队但队列/集群资源不够时，按权重等回收「应得」资源 |
| **backfill** | 尽量把 pending 任务填满节点，提高利用率 |

> 注意：`enqueue` 与 `reclaim` / `preempt` 可能冲突——若 enqueue 不允许 PodGroup 入队，controller 可能不创建 Pending Pod，后续 reclaim/preempt 也无从执行。配置时要按场景取舍。

### 2.3 常用 Plugins

| Plugin | 作用 |
|--------|------|
| **gang** | 整组调度：未 Ready 任务优先级更高；结合 `minAvailable` 决定是否驱逐 / 是否开跑 |
| **conformance** | `kube-system` 下任务更高优先，且不可被抢占 |
| **DRF** | 占用资源更少的任务更优先（主导资源公平） |
| **predicates** | 节点过滤（兼容 kube-scheduler 的 Filter 能力） |
| **nodeorder** | 节点打分优选 |
| **priority** | 比较 Job / Task 优先级（PriorityClass、创建时间等） |
| **proportion** / **capacity** | 队列应得资源（二选一，见第 17 篇） |
| **binpack** | 装箱，减少碎片 |

---

## 3. 配置入口：volcano-scheduler-configmap

配置在 ConfigMap **`volcano-scheduler-configmap`**（常见命名空间 `volcano-system`），挂载到调度器容器（如 `/volcano.scheduler`）。

查看：

```bash
kubectl get configmap -n volcano-system
kubectl get configmap volcano-scheduler-configmap -n volcano-system -o yaml
```

示例结构：

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: volcano-scheduler-configmap
  namespace: volcano-system
data:
  volcano-scheduler.conf: |
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

要点：

- `actions`：逗号分隔，**顺序即执行顺序**；Volcano 不替你校验顺序是否合理  
- `tiers`：注册到 scheduler 的 plugin 列表；action 会调用其中实现  

---

## 4. 统一调度：原生负载 + VcJob

Volcano 可通过 `predicates` / `nodeorder` 对齐 Kubernetes 的 Filter / Score，从而：

- 调度 **VcJob**（Ray、TF、PyTorch、Spark…）  
- 也能调度 **Deployment / StatefulSet / Job / DaemonSet** 等  

### 4.1 指定调度器

原生工作负载：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
spec:
  replicas: 1
  template:
    spec:
      schedulerName: volcano
      # ...
```

VolcanoJob：

```yaml
apiVersion: batch.volcano.sh/v1alpha1
kind: Job
metadata:
  name: test
spec:
  minAvailable: 1
  schedulerName: volcano
  # ...
```

### 4.2 predicates / nodeorder（简要）

- **predicates**：节点可调度性、亲和性、端口、拓扑分布等；还可开 `predicate.CacheEnable` 缓存静态过滤结果；较新版本可配合 **DRA**（需 feature gate、CDI、DRA driver 等，详见官方统一调度文档）  
- **nodeorder**：least/most requested、balanced、亲和性、镜像本地性、拓扑分布等，权重可配  

GPU 场景常与 Device Plugin 扩展资源一起用：predicates 保证「节点上有足够 `nvidia.com/gpu`」，nodeorder / binpack 决定「堆叠还是打散」。

---

## 5. 和 GPU 集群怎么配合

推荐心智模型：

```text
GPU Operator / Device Plugin
  → 暴露 nvidia.com/gpu（或 MIG / vGPU 资源名）

Volcano Queue
  → 按租户限制 capability / deserved / weight（可含 GPU）

VolcanoJob / PodGroup + Gang
  → 训练作业 minAvailable，避免半拉子 Worker 占卡

schedulerName: volcano
  → 推理 Deployment 也可走同一套优先级与队列策略（视配置而定）
```

生产队列划分示例（细节见第 17 篇）：

- `production`：在线推理，优先级高  
- `training`：可借用空闲 GPU  
- `development`：可被抢占  

---

## 6. 小结

| 概念 | 一句话 |
|------|--------|
| Action | 调度周期里的步骤 |
| Plugin | 步骤里的算法实现 |
| Queue | 多租户资源账本 |
| Gang | 凑齐再调度 |
| 统一调度 | 一个 scheduler 管批处理 + 原生负载 |

下一步：

- [Volcano Queue 与 GPU 配额管理](./05-Volcano%20Queue%20与%20GPU%20配额管理.md)  
- [Gang Scheduling 在分布式训练中的作用](./06-Gang%20Scheduling%20在分布式训练中的作用.md)  

---

## 参考与致谢

- [Volcano 官网](https://volcano.sh/zh-hans/)  
- [调度器介绍](https://volcano.sh/zh-hans/docs/scheduler/overview/)  
- [统一调度](https://volcano.sh/zh-hans/docs/v1.11.0/keyfeatures/unifiedscheduling/)  

本文基于上述 Volcano 官方文档整理，并按本系列 GPU 集群学习路线做了实践串联。
