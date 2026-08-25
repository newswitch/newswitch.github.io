---
title: "Airflow 从零到精通学习路线"
sidebar_label: "00. Airflow 从零到精通学习路线"
sidebar_position: 0
description: "从 DAG 解析和调度循环开始，系统学习 Executor、Metadata DB、HA、Kubernetes、容量、升级和生产排障。"
tags: [Airflow, DAG, Scheduler, Executor, KubernetesExecutor]
---

# Airflow 从零到精通学习路线

Airflow 是批处理和数据工作流编排平台，不是流式计算引擎。DAG 描述任务依赖，DAG Processor 解析并序列化定义，Scheduler 根据 Metadata DB 状态创建 DAG Run、判断 Task Instance 依赖，再通过 Executor 把任务交给本地进程、Celery Worker 或 Kubernetes Pod。

```text
DAG Bundle
→ DAG Processor解析与序列化
→ Metadata DB
→ Scheduler创建DagRun并选择可运行TaskInstance
→ Executor
→ Worker/Task Pod执行
→ Metadata DB更新状态
→ API Server/UI与运维人员查看
```

## 1. P0：架构、时间和状态

1. [Airflow 解决什么问题与一次 DAG Run 的完整路径](./01-Airflow解决什么问题与一次DAG-Run的完整路径.md)
2. [API Server、Scheduler、DAG Processor、Triggerer、Executor 与 Metadata DB](./02-API-Server-Scheduler-DAG-Processor-Triggerer-Executor与Metadata-DB.md)
3. [Logical Date、Data Interval、Timetable、Catchup、Backfill 与手工触发](./03-Logical-Date-Data-Interval-Timetable-Catchup与Backfill.md)
4. [Task Instance 状态机、依赖、Retry、XCom、Dataset/Asset 与幂等](./04-Task-Instance状态机-依赖-Retry-XCom-Asset与幂等.md)

## 2. P1：执行、部署和高可用

5. [LocalExecutor、CeleryExecutor、KubernetesExecutor 与多 Executor 选型](./05-LocalExecutor-CeleryExecutor-KubernetesExecutor与多Executor选型.md)
6. [Standalone、Docker Compose、systemd、官方 Helm Chart 与生产部署](./06-Standalone-Docker-Compose-systemd-Helm与生产部署.md)
7. [Metadata DB 表、连接池、迁移、清理、备份与灾难恢复](./07-Metadata-DB-表-连接池-迁移-清理-备份与恢复.md)
8. [多 Scheduler、DAG Bundle/序列化、HA、故障域与状态协调](./08-多Scheduler-DAG-Bundle-序列化-HA与状态协调.md)
9. [KubernetesExecutor、Worker Pod Template、日志、镜像和故障排查](./09-KubernetesExecutor-Worker-Pod-Template-日志-镜像与排障.md)
10. [Pool、Queue、Priority、并发、Deferrable Operator 与 Triggerer](./10-Pool-Queue-Priority-并发-Deferrable-Operator与Triggerer.md)
11. [RBAC、API 认证、Connection、Variable、Secrets Backend 与多租户边界](./11-RBAC-API认证-Connection-Variable-Secrets-Backend与多租户.md)
12. [Scheduler Lag、DAG Parse、Task Queue、SLA、容量、监控和成本](./12-Scheduler-Lag-DAG-Parse-Task-Queue-SLA-容量-监控与成本.md)

## 3. P2：升级和故障处理

13. [Airflow 2→3、Provider、Metadata Migration、DAG 兼容、升级与回滚](./13-Airflow-2到3-Provider-Metadata-Migration-DAG兼容-升级与回滚.md)
14. [Airflow 生产故障 Runbook](./14-Airflow生产故障Runbook.md)

## 4. 已有补充阅读

- [Airflow DAG、依赖、补数、重试与幂等调度](../../big-data/engineering-governance/02-Airflow-DAG依赖补数重试与幂等调度.md)
- [Airflow DAG、Task、Backfill 与恢复命令手册](../../big-data/engineering-governance/90-Airflow-DAG-Task-Backfill与恢复命令手册.md)

## 5. 必做实验

- 编写幂等 DAG，观察 DAG Parse、DagRun 与 TaskInstance；
- 区分 Logical Date、Data Interval、实际开始时间和补数区间；
- 制造 Import Error、依赖未满足、Retry、Upstream Failed 和 Zombie；
- 比较 Local、Celery 和 Kubernetes Executor 的任务路径；
- 启动两个 Scheduler，验证 Metadata DB 协调；
- 让 Metadata DB 变慢，观察 Scheduler Lag 和整个控制面；
- 使用 Pool 和并发限制保护数据库；
- 运行 Deferrable Sensor，比较 Worker Slot 占用；
- 演练 DAG 版本变化、Metadata Migration、升级和回滚。

## 6. 学习完成标准

- 能从 DAG 文件画到实际任务进程/Pod；
- 能解释 Airflow 为什么依赖 Metadata DB 协调多个 Scheduler；
- 能根据任务隔离、弹性和依赖选择 Executor；
- 能设计幂等、可补数、可重试的 DAG；
- 能规划 Scheduler、DAG Processor、Triggerer、Worker 和 DB 容量；
- 能定位任务卡在解析、创建、调度、排队、执行还是回写状态。

参考：[Airflow Architecture Overview](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/overview.html)、[Scheduler](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/scheduler.html)。
