---
title: "Airflow Scheduler Lag、DAG Parse、Task Queue、SLA、容量、监控与成本"
sidebar_label: "12. 性能分析与容量规划"
sidebar_position: 12
description: "按解析、调度、排队、启动、执行和状态回写分解 Airflow 延迟，建立容量模型和告警。"
tags: [Airflow, Performance, Capacity Planning, Monitoring]
---

# Airflow Scheduler Lag、DAG Parse、Task Queue、SLA、容量、监控与成本

“DAG 跑得慢”必须拆段。任务本身只运行 10 秒，但可能解析等 1 分钟、调度等 2 分钟、排队等 5 分钟、Pod 启动等 1 分钟。

## 1. 延迟预算

```text
总完成时间
= DAG变更到解析可见
+ Data Interval结束到DagRun创建
+ Task可运行到scheduled
+ scheduled到queued
+ queued到Worker/Pod启动
+ 任务运行
+ 状态回写与下游可见
```

为每段建立 P50/P95/P99，才能知道该扩 Scheduler、DAG Processor、Executor、Kubernetes，还是优化业务 SQL。

## 2. 核心指标

| 组件 | 指标 |
| --- | --- |
| DAG Processor | Parse 时长、Import Error、Bundle 版本、文件队列 |
| Scheduler | Heartbeat、Loop 时长、可执行/饥饿任务、创建延迟 |
| Metadata DB | 查询时延、锁、连接、CPU/IO、表增长 |
| Executor | queued 数、提交速率、失败事件 |
| Worker/Pod | 启动时延、运行时、CPU/内存、OOM/Eviction |
| Triggerer | Trigger 数、事件循环延迟、失败 |

使用 Canary DAG 周期记录各状态时间戳，避免只有内部组件“自报健康”。

## 3. 容量模型

若平均每分钟产生 `R` 个 Task，单任务平均占用 Worker `T` 分钟，则稳定状态至少需要约 `R×T` 个并发 Slot，再乘峰值和故障余量。对于 KubernetesExecutor，还要计算每秒 Pod 创建量、镜像拉取带宽和集群可调度资源。

DAG 解析容量取决于文件数、平均解析时间和刷新周期。动态生成几万个 Task 会同时放大序列化、DB 行数、Scheduler 决策和 UI 压力，优先使用 Dynamic Task Mapping 并设上限。

## 4. 性能实验

固定 DAG 与任务负载，每轮只改变一个参数；逐级增加 DAG 数、Task 数和到达速率；记录首个饱和信号；再模拟一个 Scheduler/Worker/DB 副本故障。容量目标必须在故障降级状态下仍满足关键 SLA。

## 5. 成本

短任务用每任务 Pod 可能启动成本高；长时间 Sensor 不使用 Deferrable 会浪费 Worker；过多历史和 XCom 增加 DB 成本；日志保留与对象存储请求也需预算。成本优化不能牺牲重放、审计和故障证据。

参考：[Airflow Metrics](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/logging-monitoring/metrics.html)、[Fine-tuning Scheduler](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/scheduler.html#fine-tuning-your-scheduler-performance)。
