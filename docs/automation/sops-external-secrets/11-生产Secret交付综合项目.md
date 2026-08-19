---
title: "SOPS / External Secrets 生产 Secret 交付综合项目"
sidebar_label: "11. 生产 Secret 交付项目"
sidebar_position: 11
description: "为 Kubernetes 应用构建 SOPS 加密声明、Vault 外部值、ESO 同步、轮换、审计和故障恢复闭环。"
tags: [SOPS, External Secrets Operator, Vault, Kubernetes, GitOps, 综合项目]
---

# SOPS / External Secrets 生产 Secret 交付综合项目

## 1. 场景

支付 API 使用第三方静态 Token、数据库动态凭据和 mTLS 证书。目标是按 Secret 类型选择方案，而不是全部同步成长期 Kubernetes Secret。

## 2. 架构

```text
Git（SOPS 密文）
  └── 少量低频第三方配置 / ExternalSecret 声明
Vault
  ├── KV：第三方 Token 真相来源
  ├── Database：动态账号（Agent/应用直连）
  └── PKI：短期证书（Agent/CSI）
ESO
  └── 仅同步允许持久化到 etcd 的 KV 值
GitOps
  └── 应用与 Secret 引用的期望状态
```

## 3. 权限

- 开发者可编辑开发密文，不能使用生产 KMS Decrypt。
- GitHub Actions 通过受保护 Environment + OIDC 获得短期 KMS 权限。
- 每个 Namespace 使用独立 ESO 身份，只读 Vault 对应路径。
- 应用 ServiceAccount 只读自身所需 Secret。
- 数据库/PKI 使用动态能力，不由 ESO 转换为长期共享值。

## 4. 轮换流程

1. 后端创建新版本并保留旧版本兼容窗口。
2. ESO 刷新并记录目标 ResourceVersion。
3. Reload Controller 分批重启或应用热重载。
4. 合成请求验证新版本已使用。
5. 确认所有实例完成后撤销旧值。
6. 保存审计和轮换时延报告。

## 5. 故障演练

- 删除 SOPS 接收者前验证恢复身份；
- KMS/Secret Backend 短时不可用，验证旧值和告警行为；
- Provider 返回 429，验证有限退避和刷新抖动；
- 模板字段缺失，目标 Secret 不被错误覆盖；
- 应用不重载文件，版本看板能定位到应用层；
- ESO 控制器重启后从 API 恢复协调。

## 6. 验收

交付威胁模型、密钥与身份矩阵、Secret 分类、轮换时序、端到端版本看板、恢复报告和泄漏应急 Runbook。任何 Secret 都能回答来源、消费者、当前版本、轮换方式和撤销责任人。
