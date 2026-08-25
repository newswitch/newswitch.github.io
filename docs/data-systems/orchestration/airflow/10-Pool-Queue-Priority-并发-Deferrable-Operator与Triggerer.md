---
title: "Airflow Pool、Queue、Priority、并发、Deferrable Operator 与 Triggerer"
sidebar_label: "10. 调度公平性与等待任务"
sidebar_position: 10
description: "用并发控制保护下游系统，并理解 Deferrable Operator 如何释放 Worker Slot。"
tags: [Airflow, Pool, Concurrency, Deferrable Operator, Triggerer]
---

# Airflow Pool、Queue、Priority、并发、Deferrable Operator 与 Triggerer

Airflow 能启动多少任务，不等于应该启动多少任务。并发控制的目标是让平台公平使用资源，并保护数据库、API 和计算集群不被工作流洪峰压垮。

## 1. 限制层次

```text
全局parallelism
→ Executor容量
→ 每DAG最大Active Runs/Tasks
→ Task并发限制
→ Pool Slot
→ Queue/Worker路由
→ 外部系统自身配额
```

有效并发是这些限制中的最小值。排查任务排队时应逐层检查，不能只调 `parallelism`。

## 2. Pool 与 Priority

Pool 表示某类稀缺资源，如数据库连接、GPU 作业提交或第三方 API。任务可占多个 Slot，以近似表达重量。`priority_weight` 决定同一竞争范围内谁先被选择，不创造额外容量，也不保证跨所有 Executor 的绝对优先级。

建议把在线关键链路、批量补数和低优先级维护任务放到不同 Pool；给补数设硬上限，避免历史任务淹没当天 SLA。

## 3. Queue

Celery Queue 把任务路由到安装不同依赖或拥有不同资源的 Worker。Queue 名称与 Worker 订阅必须一致，否则任务永久排队。KubernetesExecutor 更常用 Pod 资源与节点选择完成隔离。

## 4. Deferrable Operator

普通 Sensor 在等待时仍占 Worker Slot；Deferrable Operator 把等待条件交给 Triggerer 的异步事件循环，Task 进入 `deferred` 并释放 Worker，事件满足后再回到调度队列。

```text
Worker执行到defer()
→ 保存Trigger与恢复方法
→ Task=deferred，释放Worker
→ Triggerer异步等待
→ Trigger事件写回Metadata DB
→ Scheduler重新排队
```

Triggerer 是生产关键组件，要多副本、监控 Trigger 数、事件循环延迟和失败。Deferred 不等于没有成本：仍占 Metadata DB 状态和 Triggerer 容量。

## 5. 调优方法

按外部系统容量反推 Pool，而不是按 Airflow Worker 数量设置。逐步提高并发，观察 Queued P95、Scheduler Loop、DB 连接、外部 API 限流和任务失败率。性能改善必须来自瓶颈层，不是所有参数同时翻倍。

参考：[Pools](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/pools.html)、[Deferrable Operators](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/deferring.html)。
