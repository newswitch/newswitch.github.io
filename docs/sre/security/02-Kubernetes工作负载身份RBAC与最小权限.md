---
title: "Kubernetes 工作负载身份、RBAC 与最小权限"
sidebar_label: "02. 工作负载身份与 RBAC"
sidebar_position: 2
description: "区分用户、ServiceAccount、节点和云身份，设计训练推理工作负载的短期凭据与最小 API 权限。"
tags: [Kubernetes, ServiceAccount, RBAC, Workload Identity]
---

# Kubernetes 工作负载身份、RBAC 与最小权限

## 1. 四类身份

| 身份 | 典型用途 | 不应混用 |
| --- | --- | --- |
| 人用户 | 调试、提交、审批 | 不嵌入容器 |
| CI/平台服务 | 发布、创建工作负载 | 不使用个人 kubeconfig |
| ServiceAccount | Pod 调用 Kubernetes/API | 不共享给整个 Namespace |
| Node 身份 | kubelet、CSI、设备插件 | 不授予业务 Pod |

对象存储或云 API 最好通过 Workload Identity 获取短期 Token，而不是把长期 Access Key 写进 Secret。

## 2. ServiceAccount Token

Projected Service Account Token 可以设置 Audience 和有效期。应用端验证 Issuer、Audience、Signature 和 Expiry。默认 Token 若应用不需要访问 Kubernetes，应设置：

```yaml
automountServiceAccountToken: false
```

这不影响其他挂载，但减少 Token 无意暴露。

## 3. RBAC 设计

从实际 API 调用构建权限：Group、Resource、Verb、Namespace、ResourceName。避免：

- `*` Resource/Verb；
- 业务 Pod 创建 Privileged Pod；
- 读取整个 Namespace Secret；
- 修改 RoleBinding 提权；
- 读取 Node/Pod 后通过 `pods/exec` 横向移动；
- Controller 使用 Cluster Admin。

Controller 的读取和写入权限分开审视，并限制它能管理的 Label、Owner 和 Namespace。

## 4. 身份到数据权限

训练任务需要读取 Dataset、写 Checkpoint；推理任务需要读取模型，通常不应写模型仓库。让存储策略绑定 Workload Identity 和具体前缀：

```text
trainer-sa → read datasets/project-a/*
             write checkpoints/run-123/*

inference-sa → read models/model-x/revision-y/*
               no list all models
```

## 5. Namespace 不是完整安全边界

Namespace 隔离 API 对象，但节点 Kernel、GPU、设备插件、CNI 和存储仍可能共享。需要配合 Pod Security、NetworkPolicy、RuntimeClass、资源配额和节点池隔离。

## 6. 验证权限

```bash
kubectl auth can-i --as=system:serviceaccount:<ns>:<sa> get pods -n <ns>
kubectl auth can-i --as=system:serviceaccount:<ns>:<sa> list secrets -n <ns>
kubectl auth can-i --as=system:serviceaccount:<ns>:<sa> --list -n <ns>
```

`--list` 用于审计，不应把敏感输出公开。还要实际用 Token 调用目标对象存储/API，验证 Audience 和拒绝路径。

## 7. 凭据生命周期

短期凭据需要处理刷新、时钟漂移、撤销和 API 不可用。应用不应在日志中打印 Token；Crash Dump、环境变量、命令行参数和训练输出同样可能泄漏。

参考：[Kubernetes Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/)、[Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)。
