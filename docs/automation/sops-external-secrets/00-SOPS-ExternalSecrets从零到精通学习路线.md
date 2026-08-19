---
title: "SOPS / External Secrets 从零到精通学习路线"
sidebar_label: "00. SOPS / External Secrets 学习路线"
sidebar_position: 0
description: "从 Secret 生命周期开始，掌握 SOPS 信封加密、密钥轮换、GitOps，以及 External Secrets Operator 的存储、刷新、权限与排障。"
tags: [SOPS, External Secrets Operator, Kubernetes, GitOps, Secret, 学习路线]
---

# SOPS / External Secrets 从零到精通学习路线

SOPS 与 External Secrets Operator（ESO）解决的是相邻但不同的问题：SOPS 将结构化文件中的值加密，让密文可以进入 Git；ESO 从 Vault、云 Secret Manager 等外部后端读取数据，持续协调为 Kubernetes Secret。二者可以选用其一，也可以按数据来源组合。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [Secret 生命周期与方案边界](./01-Secret生命周期与方案边界.md) | 按场景选择 SOPS、ESO 或 Vault 直连 |
| 2 | [SOPS 信封加密、Metadata 与 MAC](./02-SOPS信封加密Metadata与MAC.md) | 解释密文文件和完整性保护 |
| 3 | [KMS、age、PGP 与 Key Group](./03-KMS-age-PGP与KeyGroup.md) | 设计密钥、信任域和恢复 |
| 4 | [SOPS 编辑、加解密与轮换](./04-SOPS编辑加解密与轮换.md) | 安全操作密文文件 |
| 5 | [SOPS GitOps、CI 与供应链安全](./05-SOPS-GitOps-CI与供应链安全.md) | 防止明文落盘和越权解密 |
| 6 | [ESO 架构与 Reconcile 路径](./06-ESO架构与Reconcile路径.md) | 解释外部值如何进入 Secret |
| 7 | [SecretStore、身份与多租户](./07-SecretStore身份与多租户.md) | 建立最小权限后端访问 |
| 8 | [ExternalSecret 映射、模板与刷新](./08-ExternalSecret映射模板与刷新.md) | 控制数据选择、刷新和目标生命周期 |
| 9 | [Kubernetes 工作负载轮换与一致性](./09-Kubernetes工作负载轮换与一致性.md) | 让应用真正使用新 Secret |
| 10 | [可观测、容量与故障排查](./10-可观测容量与故障排查.md) | 定位后端、控制器和应用层问题 |
| 11 | [生产 Secret 交付综合项目](./11-生产Secret交付综合项目.md) | 串联 GitOps、Vault、ESO 与发布 |

## 2. 掌握标准

- [ ] 能说明密文、数据密钥和主密钥的关系。
- [ ] SOPS 配置、文件路径和接收者变更均经过评审。
- [ ] CI 只在最小阶段解密，明文不进入缓存、日志和制品。
- [ ] ESO 身份按 Namespace/应用隔离，不能任意读取后端路径。
- [ ] 能解释刷新成功、Kubernetes Secret 更新和应用生效的时间差。
- [ ] 后端不可用、密钥丢失和控制器故障都有恢复方案。

## 3. 官方资料

- [SOPS](https://github.com/getsops/sops)
- [External Secrets Operator Documentation](https://external-secrets.io/latest/)
