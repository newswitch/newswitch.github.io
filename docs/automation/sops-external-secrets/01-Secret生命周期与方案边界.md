---
title: "Secret 生命周期与 SOPS、ESO、Vault 方案边界"
sidebar_label: "01. Secret 生命周期与边界"
sidebar_position: 1
description: "从创建、分发、使用、轮换、撤销和审计出发，选择 SOPS、External Secrets、Vault Agent 或应用直连。"
tags: [Secret Management, SOPS, External Secrets, Vault, 生命周期]
---

# Secret 生命周期与 SOPS、ESO、Vault 方案边界

## 1. Secret 不只是存储问题

```text
创建/导入 → 授权 → 分发 → 使用 → 轮换 → 撤销 → 删除 → 审计与恢复
```

把密码从 YAML 移到另一个系统只完成了存放；应用如何获得、缓存、重载和失效才决定真实风险窗口。

## 2. 方案对比

| 方案 | 真相来源 | 适合 | 主要边界 |
| --- | --- | --- | --- |
| SOPS | Git 中的加密文件 | GitOps 配置、低频静态值 | 解密身份、明文处理、轮换协同 |
| ESO | 外部 Secret Backend | Kubernetes 同步外部值 | 最终仍生成 Kubernetes Secret |
| Vault Agent/CSI | Vault | 动态凭据、证书、文件注入 | 应用重载、Vault 可用性 |
| 应用 SDK 直连 | 外部 Secret 服务 | 细粒度动态访问 | 应用承担认证、缓存和续租 |

## 3. Kubernetes Secret 的事实

Kubernetes Secret 是 API 对象，不因名称叫 Secret 就天然安全。它受 etcd 加密、RBAC、节点/Pod 访问、审计、备份和应用日志影响。ESO 同步后仍需保护这些边界。

## 4. 选择问题

- 数据由谁创建和轮换？
- 是否需要动态账号/租约而不是静态值？
- 控制面不可用时新旧 Pod 如何行为？
- 允许 Secret 持久化到 etcd 吗？
- 需要 Git 回滚 Secret 版本，还是后端独立版本？
- 谁能修改引用，谁能读取明文，谁能审批生产？

## 5. 组合方式

可以用 SOPS 保存 ESO 的非敏感声明和少量启动材料，由 ESO 获取业务 Secret；也可用 SOPS 管理完全离线环境的密文。不要用 SOPS 加密一个长期 Vault Root Token，再让所有工作负载共享。

## 6. 威胁模型

分别考虑 Git 仓库泄漏、CI Runner 被控制、KMS 权限过宽、集群管理员、应用进程读取、日志泄漏和备份泄漏。任何方案都要说明攻击者获得密文、Kubernetes 读权限或工作负载身份后的影响。
