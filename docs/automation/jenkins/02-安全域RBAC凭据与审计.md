---
title: "Jenkins 安全域、RBAC、凭据与审计"
sidebar_label: "02. 安全域、RBAC、凭据与审计"
sidebar_position: 2
description: "治理身份源、授权、项目隔离、凭据 Scope、不可信 Jenkinsfile、Script Approval 与审计。"
tags: [Jenkins, Security, RBAC, Credential, Audit]
---

# Jenkins 安全域、RBAC、凭据与审计

## 1. 信任边界

Jenkinsfile 是代码。能够修改 Pipeline 的人可能间接执行 Agent 命令、读取可见凭据或上传制品，因此分支保护和凭据 Scope 是安全控制的一部分。

## 2. 身份与授权

- 接入组织身份源和 MFA。
- 禁止匿名管理和默认共享管理员。
- 管理、配置 Job、构建、审批、凭据和发布职责分离。
- Folder/项目权限与 Agent/凭据范围一致。

## 3. 凭据

- 使用最小 Scope 和短期身份。
- 构建与部署凭据分离。
- Fork/不可信 PR 不注入 Secret。
- 不把 Secret 放命令行、环境转储、归档和缓存。
- Mask 只能降低日志暴露，恶意 Pipeline 仍可编码外传。

## 4. Script Security

Groovy Script Approval 不是例行点击。批准的方法可能扩大 Controller 权限，应审查调用和替代方案。优先 Declarative Pipeline 与受控 Shared Library。

## 5. Agent 隔离

不同信任级别使用独立 Agent Pool、网络、ServiceAccount 和缓存。生产部署 Agent 不运行外部 PR。

## 6. 审计

记录配置变更、凭据使用、构建触发、审批、Agent、制品 Digest 和部署结果。日志保存策略与隐私要求一致。
