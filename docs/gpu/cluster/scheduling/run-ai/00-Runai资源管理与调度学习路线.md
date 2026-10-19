---
title: "Run:ai 资源管理与调度学习路线"
sidebar_label: "00. Run:ai 资源管理与调度学习路线"
sidebar_position: 0
description: "以组织资源、配额公平性、工作负载和 Kubernetes 控制面为主线学习 Run:ai。"
tags: [Runai, Kubernetes, GPU, 配额, 调度]
---

# Run:ai 资源管理与调度学习路线

Run:ai 在 Kubernetes 之上管理 AI 资源与工作负载。学习重点不是界面上如何提交一个任务，而是组织预算如何成为调度约束、借用资源何时会被收回，以及任务状态如何对应底层 Pod 和 GPU。

## 1. 前置知识

先阅读[优先级与抢占](../03-GPU%20集群优先级与抢占策略.md)、[Kueue 准入](../13-Kueue队列配额与工作负载准入.md)、[MIG](../../sharing/09-MIG%20原理与%20Kubernetes%20配置.md)。它们帮助理解通用问题，但其具体字段与行为不能直接替代 Run:ai。

## 2. 阅读顺序

1. [架构与部署边界](./01-控制面集群组件与部署边界.md)：区分 SaaS、自托管控制面与集群组件。
2. [组织与资源模型](./02-Department-Project权限与资源模型.md)：区分授权、预算与物理资源。
3. [配额与公平调度](./03-Quota-Fairshare借用回收与抢占.md)：逐层手算部门/项目、Rank、上限和整组回收，比较即时与时间型 Fairshare。
4. [工作负载生命周期](./04-训练推理工作负载与PodGroup生命周期.md)：从提交追踪到应用就绪。
5. [观测与故障分析](./05-状态观测容量分析与恢复边界.md)：分开诊断配额、放置、启动与数据面。
6. [分数 GPU 与隔离](./06-GPU分数资源显存限制与隔离边界.md)：分开推导显存预算、计算竞争与租户归因。
7. [节点池、拓扑与碎片](./07-节点池拓扑调度与资源碎片.md)：解释有配额、有空闲但整组作业仍不能放置。
8. [控制面高可用与恢复](./08-控制面高可用状态持久化与断连恢复.md)：区分服务、数据库、双 Prometheus 与执行事实，沿 v3.0 配置推演历史账本持久化和恢复公平性。
9. [Access Rules 与权限治理](./09-AccessRules角色作用域与权限治理.md)：沿主体、角色、作用域和集群同步解释授权、旁路与撤销证据。
10. [策略继承与模板资产治理](./10-工作负载策略继承模板与资产治理.md)：分别推导原生和注册类型的有效规则，区分默认值、强制约束与可复用配置。

## 3. 版本与环境

架构和术语依据 NVIDIA self-hosted 文档在 2026 年 10 月的公开说明；实际部署必须固定控制面版本、集群组件、Helm Chart、Kubernetes 与驱动支持矩阵。SaaS、自托管和 DGX Cloud 托管服务的权限边界不同，不能把托管环境限制当成自托管产品的统一限制。

正文的数字例子是简化模型，不是软件调度输出。多层部门、不同节点池、作业不可拆分及放置约束会改变结果。只有明示条件后计算出来的分配，才有解释价值。

## 4. 掌握标准

面对一个 Pending 训练任务，能先判断它是否有资格获得资源，再判断资源是否能按形状放置；面对资源回收，能解释项目间公平与项目内优先级的区别；面对控制面断连，能用底层 Kubernetes 事实判断实际运行状态，而不是仅看最后一次界面刷新。

面对治理问题，能从实际主体追到角色、作用域和执行端同步，不能用角色名称代替有效授权；能解释项目规则为何保存了却不生效、模板为何不能代替策略，以及 v3.0 计算共享模式如何改变碎片、故障域和指标归因。

## 5. 参考资料

- [Run:ai 架构](https://run-ai-docs.nvidia.com/self-hosted/getting-started/overview)
- [调度概念](https://run-ai-docs.nvidia.com/self-hosted/platform-management/runai-scheduler/scheduling/concepts-and-principles)
- [调度过程](https://run-ai-docs.nvidia.com/self-hosted/platform-management/runai-scheduler/scheduling/how-the-scheduler-works)
