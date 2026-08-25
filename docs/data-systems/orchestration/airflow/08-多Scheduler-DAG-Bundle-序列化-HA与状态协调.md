---
title: "Airflow 多 Scheduler、DAG Bundle、序列化、HA 与状态协调"
sidebar_label: "08. Scheduler 高可用与 DAG 分发"
sidebar_position: 8
description: "理解多个 Scheduler 如何通过 Metadata DB 协调，以及 DAG 解析、序列化、分发和高可用的真实边界。"
tags: [Airflow, Scheduler, High Availability, DAG Bundle]
---

# Airflow 多 Scheduler、DAG Bundle、序列化、HA 与状态协调

Airflow 的 Scheduler HA 不依赖单独的 Scheduler Leader。多个 Scheduler 通过 Metadata DB 锁和状态竞争可调度的 Task Instance。DB 的并发语义和性能因此成为 HA 的基础。

## 1. 调度循环

```text
DAG Processor读取DAG Bundle
→ 解析并写Serialized DAG
→ Scheduler创建/检查DagRun
→ 在Metadata DB中锁定可运行TaskInstance
→ 受并发与Pool约束选择任务
→ 交给Executor
→ Executor事件回写状态
```

多 Scheduler 提升吞吐和故障接管，但不会修复低效 DAG、慢 DB 或容量不足的 Executor。

## 2. DAG Bundle 与序列化

DAG 文件可能来自本地目录、Git Sync、镜像或版本化 Bundle。所有 DAG Processor 必须看到一致版本；否则同一 DAG 会反复增删 Task。序列化后 Scheduler/UI 不必导入所有用户代码，隔离了部分依赖，但解析阶段仍会执行 DAG 顶层 Python。

发布 DAG 应原子化：一个版本完整到达后再被解析，避免 Git 更新一半。记录 Bundle Version，使每个 DagRun 可追溯到代码版本。

## 3. HA 故障域

- Scheduler 分散到不同节点/可用区；
- Metadata DB 自身具备 HA 和低延迟；
- DAG Processor 与 DAG Source 不形成单点；
- Triggerer 多副本承载 Deferred Task；
- Remote Logging 确保 Worker 消失后日志仍在；
- Executor/Broker/Kubernetes API 有独立容量和告警。

## 4. 容量与调优

增加 Scheduler 前先测 Scheduler Loop、DB CPU/锁、可调度 Task 数和 Executor 提交速率。过多 Scheduler 会提高 DB 锁竞争。DAG 数量、每 DAG Task 数、动态 DAG 生成时间和解析间隔共同决定 DAG Processor 压力。

顶层代码禁止查询外部数据库或做重计算；将动态配置缓存或生成静态 DAG。解析慢会让新 DAG/变更很晚才出现。

## 5. 故障实验

删除一个 Scheduler，验证任务继续创建；让一个 DAG Processor 使用旧 Bundle，观察版本告警；降低 DB 性能，观察 Scheduler Heartbeat/Loop；阻断 Executor，验证任务停在 queued 而不是丢失；恢复后确认状态最终收敛且无重复副作用。

参考：[Airflow Scheduler](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/scheduler.html)、[DAG Serialization](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/dag-serialization.html)。
