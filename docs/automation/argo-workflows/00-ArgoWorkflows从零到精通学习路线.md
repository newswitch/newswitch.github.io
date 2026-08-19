---
title: "Argo Workflows 从零到精通学习路线"
sidebar_label: "00. Argo Workflows 学习路线"
sidebar_position: 0
description: "从 Workflow CRD 和 Controller 开始，掌握 DAG、制品、模板、并发治理、GPU 调度、可观测和生产批处理。"
tags: [Argo Workflows, Kubernetes, DAG, Workflow, AI Infra, 学习路线]
---

# Argo Workflows 从零到精通学习路线

Argo Workflows 是运行在 Kubernetes 上的工作流编排引擎，用 Workflow CRD 描述 Steps 或 DAG，并由 Controller 创建和协调 Pod。它与 Argo CD 解决的问题不同：Argo Workflows 运行有开始和结束的任务图，Argo CD 持续把集群状态协调到 Git 中的期望状态。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [架构、CRD 与执行路径](./01-架构CRD与执行路径.md) | 解释 Workflow 到 Pod 的控制链 |
| 2 | [部署、RBAC、SSO 与多租户](./02-部署RBAC-SSO与多租户.md) | 建立安全的生产控制面 |
| 3 | [Template、Steps、DAG 与数据依赖](./03-Template-Steps-DAG与数据依赖.md) | 正确建模任务图和失败传播 |
| 4 | [参数、输出、Artifact 与制品仓库](./04-参数输出Artifact与制品仓库.md) | 传递小数据和大制品 |
| 5 | [重试、超时、同步、退出与幂等](./05-重试超时同步退出与幂等.md) | 构建可恢复工作流 |
| 6 | [WorkflowTemplate、Cron 与复用治理](./06-WorkflowTemplate-Cron与复用治理.md) | 建立版本化平台模板 |
| 7 | [资源、调度、GPU 与并行容量](./07-资源调度GPU与并行容量.md) | 控制集群和加速资源使用 |
| 8 | [Archive、指标、日志与故障排查](./08-Archive指标日志与故障排查.md) | 运营和定位生产问题 |
| 9 | [事件、CI、Argo CD 与系统边界](./09-事件CI-ArgoCD与系统边界.md) | 串联事件、构建、任务与交付 |
| 10 | [AI Infra 批处理综合项目](./10-AI-Infra批处理综合项目.md) | 编排数据准备、GPU 推理和评估 |

## 2. 核心原则

- Workflow 状态存于 Kubernetes API/归档库，Artifact 数据存于制品仓库，两者不是同一个备份对象。
- 重试只适合可识别的瞬时故障；任务本身必须幂等或带唯一操作键。
- Pod 成功只表示进程退出码符合预期，不等于业务结果已正确写入。
- Controller 高可用不等于无限并行；API Server、Pod 调度、存储和下游都有容量上限。
- GPU 任务要同时考虑设备资源、显存、拓扑、数据供给和队列公平性。

## 3. 官方资料

- [Argo Workflows Documentation](https://argo-workflows.readthedocs.io/)
