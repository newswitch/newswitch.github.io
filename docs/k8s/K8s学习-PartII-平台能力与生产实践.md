---
title: "K8s 学习 · Part II：平台能力与生产实践"
date: 2026-03-19 15:02:10
categories: 云原生
tags: [Kubernetes, 学习路线, 生产实践, 运维]
---

# K8s 学习 · Part II：平台能力与生产实践

## 学习目标

- 能在生产视角理解与落地：安全、发布、可观测性、集群运维、应用交付。
- 形成一套可复用的排障路径：从现象→指标→日志→事件→配置→回滚。

## 精读目录（按书的 Part II 组织）

### 安全

- 认证与鉴权
- ValidatingWebhook
- NetworkPolicy
- TLS 与证书管理（kubelet / kubeconfig / bootstrap 等）
- 安全最佳实践

### 访问集群

- kubectl 命令行工具
- kubeconfig 与跨集群
- 端口转发、通过 Service、从外部访问 Pod
- k9s / Dashboard（按需）

### 扩展 Kubernetes（生产视角）

- APIService / CRD（与 Part III 呼应）
- Admission Webhook（变更策略与审计）
- Scheduler Framework / DRA（了解为主）

### 多集群管理

- 多集群架构与 API 演进
- Karmada / k0rdent（按需了解）

### 命令与调试

- Kubectl 命令技巧大全
- 调试集群中的 Pod

### 集群运维

- 版本发布管理
- 集群生命周期管理

### 部署应用

- Helm
- Kustomize
- ArgoCD（GitOps）
- 渐进式交付（Argo Rollouts 等）

### 可观测性

- 监控 / 日志 / 链路追踪 / 告警
- 可视化仪表板
- OpenTelemetry（与追踪打通）

### 开发指南（平台工程视角）

- client-go / informer
- Operator
- 测试与社区

### Minikube（工具篇，按需）

## 实操清单（建议每项都留下“复盘记录”）

1. 安全基线：RBAC 最小权限 + NetworkPolicy 最小放行 + Secret 管理策略。
2. 发布策略：RollingUpdate + 灰度（至少一种工具链：Helm 或 ArgoCD）。
3. 可观测性三件套：Prometheus + Loki/ELK + Tempo/Jaeger（任选组合）。
4. 运维：节点故障、控制面抖动、etcd 空间、证书过期等典型问题各做一次演练。

## 参考

- Kubernetes 教程（Jimmy Song）：https://jimmysong.io/zh/book/kubernetes-handbook/
- Kubernetes 官方文档：https://kubernetes.io/docs/
