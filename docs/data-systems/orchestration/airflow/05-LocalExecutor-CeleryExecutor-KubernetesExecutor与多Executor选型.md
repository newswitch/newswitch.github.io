---
title: "Airflow LocalExecutor、CeleryExecutor、KubernetesExecutor 与多 Executor 选型"
sidebar_label: "05. Executor 原理与选型"
sidebar_position: 5
description: "比较 Airflow Executor 的任务提交路径、隔离、弹性、故障域和多 Executor 使用边界。"
tags: [Airflow, Executor, CeleryExecutor, KubernetesExecutor]
---

# Airflow LocalExecutor、CeleryExecutor、KubernetesExecutor 与多 Executor 选型

Executor 接收 Scheduler 选出的 Task Instance，并把它变成可运行进程。它不决定 DAG 依赖，也不负责业务计算逻辑，但决定任务在哪里运行、如何排队和怎样报告状态。

## 1. 三条执行路径

```text
Local: Scheduler → 本机子进程
Celery: Scheduler → Broker → Celery Worker → 子进程
Kubernetes: Scheduler → Kubernetes API → Worker Pod
```

| 维度 | LocalExecutor | CeleryExecutor | KubernetesExecutor |
| --- | --- | --- | --- |
| 运维复杂度 | 低 | 中，需 Broker/Worker | 中高，依赖 K8s |
| 任务隔离 | 进程级 | Worker/Queue 级 | Pod/镜像/资源级 |
| 启动延迟 | 低 | 低到中 | 受调度、拉镜像影响 |
| 弹性 | 单机边界 | 扩 Worker | 每任务 Pod，弹性强 |
| 依赖差异 | 较难 | Queue 分组 | 每任务可定制镜像/Pod |
| 主要故障 | Scheduler 主机 | Broker/Worker | API、调度、镜像、Pod |

## 2. 选型方法

小规模、依赖一致、单机资源足够可用 Local；大量短任务且重视低启动延迟可用 Celery；任务依赖差异大、需资源隔离或 GPU/大内存可用 Kubernetes。不要仅因为平台已有 Kubernetes 就忽略每任务 Pod 的启动成本。

Airflow 新版本支持按任务选择多个 Executor。适合把短小控制任务放 Local/Celery，把隔离型计算放 Kubernetes；代价是观测和排障路径增加，团队必须能识别任务实际落在哪个 Executor。

## 3. 容量

Executor 容量不是越大越好。Scheduler 并发、Global Parallelism、DAG/Task 并发、Pool、Broker、Kubernetes API 和下游数据库共同限制吞吐。允许 1000 个任务并发，并不代表目标数据库承受得住 1000 个连接。

压测要测任务提交速率、Queued 时长、启动时延、状态回写时延和故障恢复，不只测任务运行时间。

## 4. 故障定位

- `scheduled`：先查 Scheduler、依赖和 Pool；
- `queued`：查 Executor 队列、Worker/Pod 创建和资源；
- Worker 已执行但 UI 仍 queued：查状态回写、Metadata DB 和 Zombie 检测；
- Kubernetes Pod Pending：查配额、NodeSelector、Taint、PVC 和镜像；
- Celery 队列堆积：查 Broker、Queue 路由、Worker 并发和预取。

## 5. 验收实验

对同一组短/长/大内存任务分别运行三种 Executor；删除 Worker、阻断 Broker、制造 Pod Pending；记录 Queued P95、恢复时间、资源成本与状态一致性，再做选型。

参考：[Airflow Executors](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/executor/index.html)。
