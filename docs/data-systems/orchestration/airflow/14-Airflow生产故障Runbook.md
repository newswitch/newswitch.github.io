---
title: "Airflow 生产故障 Runbook"
sidebar_label: "14. Airflow 生产故障 Runbook"
sidebar_position: 14
description: "按 DAG 解析、DagRun 创建、Task 调度、Executor、Worker 和状态回写分层定位 Airflow 故障。"
tags: [Airflow, Runbook, Troubleshooting, SRE]
---

# Airflow 生产故障 Runbook

先定位任务停在哪个状态转换，再操作。反复 Clear Task 会破坏时间线，并可能让已成功的外部任务重复执行。

## 1. 影响与取证

记录首次异常、DAG/Task/Run ID、Logical Date/Data Interval、当前状态、Try Number、代码/镜像版本、最近部署和外部系统状态。保存 Scheduler、DAG Processor、Executor、Worker/Pod 与 Metadata DB 同一时间窗口的证据。

## 2. 决策树

```text
DAG是否可见且无Import Error？
├─ 否：DAG Bundle/解析/依赖
└─ 是：DagRun是否按区间创建？
   ├─ 否：Schedule、start_date、catchup、Scheduler/DB
   └─ 是：Task状态？
      ├─ none/scheduled：依赖、Pool、并发、Scheduler
      ├─ queued：Executor、Broker/Worker、Kubernetes
      ├─ running：任务、外部Job、Heartbeat、超时
      ├─ deferred：Triggerer与Trigger
      └─ failed/upstream_failed：首个业务错误与Trigger Rule
```

## 3. 常见场景

| 现象 | 优先证据 | 动作 |
| --- | --- | --- |
| DAG 消失 | Import Error、Bundle Version、Parse Log | 修复顶层代码/依赖，验证原子发布 |
| 没有 DagRun | Timetable、Pause、Start Date、Scheduler Heartbeat | 校正时间语义，不手工补错区间 |
| Queued 堆积 | Pool、Executor Queue、Worker/Pod | 从首个饱和层扩容或限流 |
| Zombie | Task Host/Pod、Heartbeat、DB 延迟 | 先确认外部作业，再处理状态 |
| Scheduler Lag | Loop、DB 锁/慢 SQL、DAG 解析 | 优化瓶颈，避免盲增 Scheduler |
| DB 故障恢复 | DB 备份、外部 Job、状态时间线 | 恢复后对账，禁止全量盲重跑 |

## 4. 常用检查

```bash
airflow dags list-import-errors
airflow dags list-runs -d DAG_ID
airflow tasks states-for-dag-run DAG_ID RUN_ID
airflow jobs check --job-type SchedulerJob --allow-multiple --limit 100
```

KubernetesExecutor 同时检查 Pod Event、调度原因、镜像和 OOM；Celery 检查 Broker、Worker Queue 和并发。命令只能提供证据，不能替代状态机判断。

## 5. 恢复验证

先运行无副作用的 Canary，再恢复一个关键 DAG；核对 Data Interval 和目标分区；对运行中/状态未知任务逐个确认外部结果；观察 Queued 与 Scheduler Lag 回落。事后复盘必须包含为什么监控没更早发现，以及如何自动化阻断重复副作用。

参考：[Airflow Troubleshooting](https://airflow.apache.org/docs/apache-airflow/stable/troubleshooting.html)、[CLI and Environment Variables Reference](https://airflow.apache.org/docs/apache-airflow/stable/cli-and-env-variables-ref.html)。
