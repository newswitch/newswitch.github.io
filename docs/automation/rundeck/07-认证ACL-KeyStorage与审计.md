---
title: "Rundeck 认证、ACL、Key Storage 与审计"
sidebar_label: "07. 认证、ACL 与 Key Storage"
sidebar_position: 7
description: "接入 SSO，使用 ACL Policy、服务身份、Key Storage、Secure Option 和审计建立最小权限。"
tags: [Rundeck, ACL Policy, Key Storage, SSO, Security]
---

# Rundeck 认证、ACL、Key Storage 与审计

## 1. 授权对象

Rundeck 权限覆盖 Project、Job、Node、Execution、Storage 和系统管理等。用户能看到 Job 不应自动意味着能运行；能运行也不应能编辑、删除或读取凭据。

## 2. SSO 与 Group

通过 OIDC/LDAP 等接入稳定身份和 Group，避免按可变显示名授权。离职和组变更需要及时生效，保留独立 Break-glass 管理身份并启用 MFA/审计。

## 3. ACL Policy

按团队、环境和动作拆分策略：开发团队可运行开发 Job；生产变更由 On-call/审批组运行；平台管理员维护 Job 但日常不使用系统管理员权限。

先用测试身份验证允许与拒绝路径。过宽正则、项目通配和 Node Filter 可能越权。

## 4. Key Storage

Key Storage 保存密码、私钥、Token 或外部 Secret 引用。限制按路径读取/使用/管理；Job 可使用某个 Key 不代表用户能查看明文。优先 Vault 插件、短期 SSH 证书和动态 Token。

备份 Key Storage 时同时保护加密密钥；日志和导出的 Job 定义不包含实际 Secret。

## 5. Secure Option

Secure Option 适合一次性敏感输入，但值可能进入目标进程环境或命令。禁止回显、捕获输出或下游通知。长期 Secret 不应由用户反复粘贴。

## 6. 审批与职责分离

高风险流程分离 Job Author、Approver、Executor 和 Auditor。批准材料包含目标快照、参数、变更、回滚和制品版本。审批后若参数/目标变化需重新审批。

## 7. 审计

记录用户/服务身份、触发源、Job 版本、Options（脱敏）、实际节点、Step 结果、凭据路径、Execution ID 和外部变更 ID。审计日志集中保存并限制读取。
