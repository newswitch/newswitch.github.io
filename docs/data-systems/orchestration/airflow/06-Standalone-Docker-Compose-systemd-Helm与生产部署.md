---
title: "Airflow Standalone、Docker Compose、systemd、Helm 与生产部署"
sidebar_label: "06. 多种部署方式与生产验收"
sidebar_position: 6
description: "从单机学习环境到 Kubernetes Helm，理解 Airflow 组件、状态、升级和生产部署边界。"
tags: [Airflow, Deployment, Helm, Kubernetes]
---

# Airflow Standalone、Docker Compose、systemd、Helm 与生产部署

部署方式可以不同，但生产必需组件不变：API Server/UI、Scheduler、DAG Processor、Triggerer、Executor/Worker、Metadata DB、DAG 分发和远程日志。

## 1. 方式与边界

| 方式 | 用途 | 不适合直接用于生产的原因 |
| --- | --- | --- |
| `airflow standalone` | 本地学习、快速验证 | 单机、默认配置、无完整 HA |
| Docker Compose Quick Start | 理解组件与开发 | 示例凭据/资源/持久化不满足生产 |
| systemd + 虚机 | 稳定传统环境 | 需自行管理 HA、发布和日志 |
| 官方 Helm Chart | Kubernetes 生产基线 | 仍需设计 DB、DAG、日志、Secret、升级 |

## 2. systemd 生产思路

为 API Server、Scheduler、DAG Processor、Triggerer、Celery Worker 分别建服务单元和低权限用户；配置明确的重启策略、文件描述符、环境文件、日志轮转和依赖顺序。Metadata DB 使用外部 PostgreSQL/MySQL 高可用服务，不把 SQLite 用于并发生产。

## 3. Helm 关键决策

- Executor 类型和 Worker 生命周期；
- DAG 通过 Git Sync、镜像还是外部 Bundle 分发；
- 日志写远程对象存储并验证读取凭据；
- 外部 Metadata DB、连接池与迁移 Job；
- Web/API 认证、Ingress/TLS、NetworkPolicy；
- Scheduler/DAG Processor/Triggerer 副本与资源；
- Secret Backend，而不是把凭据写入 values；
- PDB、反亲和、Topology Spread 与存储故障域。

## 4. 上线顺序

固定 Airflow、Provider、Python 和系统依赖版本；初始化/迁移 Metadata DB；部署控制面；验证 DAG 解析；再启用 Worker 和业务 DAG。迁移数据库必须是显式变更步骤，避免多个 Pod 同时自动迁移。

## 5. 验收

除了 `airflow info` 和组件健康，还要运行 Canary DAG，覆盖 Task Queue、远程日志、XCom、Secret、外部数据库、重试和告警。删除 Scheduler/Worker Pod，验证接管；重启后确认运行中任务的最终状态可收敛。

## 6. 生产禁区

不要使用默认账号和示例 Secret；不要把 DAG 只放某个 Pod 本地；不要让任务日志仅在临时容器；不要在未备份 Metadata DB 时升级；不要用 Liveness 杀掉“正在忙但仍正确”的 Scheduler。

参考：[Airflow Production Deployment](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/production-deployment.html)、[Official Helm Chart](https://airflow.apache.org/docs/helm-chart/stable/index.html)。
