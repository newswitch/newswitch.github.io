---
title: "External Secrets SecretStore、身份与多租户"
sidebar_label: "07. Store、身份与多租户"
sidebar_position: 7
description: "使用 Namespace Store、Workload Identity、后端 Policy 和控制器分片建立最小权限多租户边界。"
tags: [External Secrets Operator, SecretStore, Workload Identity, RBAC, 多租户]
---

# External Secrets SecretStore、身份与多租户

## 1. Store 不是简单连接字符串

Store 定义 Provider Endpoint、认证方法、后端范围和 TLS 等。能创建/引用 Store 的人可能扩大可读 Secret 范围，因此 CRD RBAC 与后端 IAM/Policy 必须同时控制。

## 2. `SecretStore` 与 `ClusterSecretStore`

Namespace Store 更适合租户隔离；Cluster Store 减少重复配置，但容易形成全局高权限入口。Cluster Store 应限制可引用 Namespace、后端路径和身份，不把“集群可见”误认为“全租户可读”。

## 3. 身份选择

优先 Kubernetes/云 Workload Identity 或 Vault Kubernetes Auth，使用短期令牌和明确 Audience/Subject。避免把长期云 Access Key 保存为另一个 Kubernetes Secret 再给全局控制器读取。

## 4. 权限矩阵

```text
team-a namespace
  → team-a Store
  → team-a workload identity
  → backend path /prod/team-a/* read-only
  → 只能写 team-a namespace 的目标 Secret
```

后端策略和 Kubernetes RBAC 双向限制。即使 ExternalSecret 能指定任意远端 Key，也只能读取身份授权范围。

## 5. 控制器部署模型

高隔离场景可按租户/信任域部署独立 Controller、ServiceAccount 和 Namespace Scope；共享 Controller 则需更严格的 Store 引用、Admission 和网络策略。控制器不应能读取所有目标 Secret 之外的业务资源。

## 6. TLS 与网络

Provider Endpoint 使用可信 TLS，企业 CA 受控分发；NetworkPolicy/防火墙只允许所需后端。禁止永久跳过证书验证。代理和 DNS 变更纳入审计。

## 7. 验收

使用测试租户尝试读取其他团队路径、引用全局 Store、写入其他 Namespace 和创建高权限身份，所有越权路径都应被 Kubernetes 或后端拒绝并留下审计。
