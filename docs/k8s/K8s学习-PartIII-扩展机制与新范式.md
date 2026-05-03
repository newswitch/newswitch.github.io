---
title: "K8s 学习 · Part III：扩展机制与新范式"
date: 2026-03-19 15:02:20
categories: 云原生
tags: [Kubernetes, 学习路线, 扩展, 新范式]
---

# K8s 学习 · Part III：扩展机制与新范式

## 学习目标

- 理解 Kubernetes 的可扩展性边界：API 扩展、控制器/Operator、调度扩展、准入扩展。
- 掌握新范式：Serverless、边缘、多集群、云原生到 AI 原生的演进方向。

## 精读目录（按书的 Part III 组织）

### Serverless

- Knative（Serving / Eventing）
- Kubernetes 原生 Serverless 模式
- OpenFaaS

### 边缘计算

- KubeEdge
- K3s
- OpenYurt / SuperEdge

### 云原生

- 云原生的设计哲学
- CNCF 与生态
- 规范模型与角色分工

### AI 原生

- 从云原生到 AI 原生
- AI Gateway / 推理优化 / 可观测性
- AI 工作负载调度、GPU 与动态资源分配（DRA）
- 设备插件、算力虚拟化（按需）

## K8s 扩展机制速记（建议先把这张表背下来）

| 扩展点 | 你要解决的问题 | 典型手段 |
| --- | --- | --- |
| API 扩展 | 新资源类型与 API | CRD / API Aggregation / APIService |
| 控制面逻辑扩展 | 新的控制循环 | Controller / Operator（Kubebuilder/Operator SDK） |
| 准入扩展 | 创建/更新时校验与变更 | ValidatingWebhook / MutatingWebhook |
| 调度扩展 | 自定义调度决策 | Scheduler Framework 插件 / 多调度器 |
| 运行时/网络/存储扩展 | 对接不同底座能力 | CRI / CNI / CSI |

## 实操清单（建议做 2-3 个代表性项目）

1. 写一个最小 CRD + Controller：实现期望状态→实际状态的 reconcile。
2. 写一个 ValidatingWebhook：对资源做策略校验（配合证书与审计）。
3. 选一个新范式落地：Knative（Serverless）或 KubeEdge（边缘）或 Karmada（多集群）。

## 参考

- Kubernetes 教程（Jimmy Song）：https://jimmysong.io/zh/book/kubernetes-handbook/
- Kubernetes 官方文档：https://kubernetes.io/docs/
