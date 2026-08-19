---
title: "GitLab CI Token、OIDC、Secret 与供应链安全"
sidebar_label: "07. Token、OIDC 与供应链安全"
sidebar_position: 7
description: "治理 Job Token、Deploy Token、短期云身份、保护变量、不可信 Pipeline、依赖与制品签名。"
tags: [GitLab CI, Token, OIDC, Secret, Supply Chain]
---

# GitLab CI Token、OIDC、Secret 与供应链安全

## 1. 最小身份

不同用途使用不同身份：拉源码、读依赖、写候选制品、部署测试、部署生产。优先通过 OIDC/工作负载联合获取短期云凭据。

## 2. 变量保护

Masked 只减少日志显示，Protected 限制到保护 Ref；恶意可信 Pipeline 仍可能外传 Secret。真正边界是分支保护、评审、Runner 隔离和短期权限。

## 3. Fork/MR

不可信代码：

- 无保护变量和生产 Token。
- 无内网和特权 Runner。
- 不允许修改被信任后自动执行的 Include。
- 产物在进入可信流水线前重新验证。

## 4. Include

远程模板固定不可变 Ref/版本，审查来源。可变主分支 Include 等于把流水线控制权交给外部最新代码。

## 5. 供应链

锁定依赖、隔离构建、生成 SBOM、扫描、签名并按 Digest 部署。发布签名 Key 不暴露给普通构建。

## 6. 审计

关联 Commit、Pipeline、Runner、身份、Artifact/镜像 Digest、审批、环境和部署结果。
