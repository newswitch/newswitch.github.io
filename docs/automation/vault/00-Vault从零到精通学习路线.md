---
title: "HashiCorp Vault 从零到精通学习路线"
sidebar_label: "00. Vault 学习路线"
sidebar_position: 0
description: "从信任模型、Seal 和策略开始，掌握动态凭据、PKI、Kubernetes 注入、租约、审计、备份与生产治理。"
tags: [Vault, Secret, PKI, 动态凭据, Kubernetes, 学习路线]
---

# HashiCorp Vault 从零到精通学习路线

本文模块讨论的是 HashiCorp Vault 服务，不是 Ansible Vault 文件加密功能。HashiCorp Vault 通过认证、策略、Secret Engine、租约和审计，把长期静态 Secret 转化为可授权、可轮换、可撤销的访问能力。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [架构、Barrier、Seal 与请求路径](./01-架构Barrier-Seal与请求路径.md) | 解释启动、解封和请求处理 |
| 2 | [生产部署、Integrated Storage 与高可用](./02-生产部署IntegratedStorage与高可用.md) | 设计节点、TLS、存储和自动解封 |
| 3 | [认证、Token、Policy 与 Identity](./03-认证Token-Policy与Identity.md) | 建立最小权限身份体系 |
| 4 | [KV Secret、版本、删除与恢复](./04-KV-Secret版本删除与恢复.md) | 管理静态配置和版本生命周期 |
| 5 | [数据库动态凭据](./05-数据库动态凭据与轮换.md) | 生成短期数据库账号并撤销 |
| 6 | [PKI、证书与 SSH 凭据](./06-PKI证书与SSH凭据.md) | 建立短期证书和主机访问身份 |
| 7 | [Kubernetes Auth、Agent 与 CSI](./07-Kubernetes-Auth-Agent与CSI.md) | 为工作负载安全交付 Secret |
| 8 | [Lease、Renew、Revoke 与故障语义](./08-Lease-Renew-Revoke与故障语义.md) | 处理凭据生命周期和异常 |
| 9 | [Transit 加密即服务](./09-Transit加密即服务.md) | 分离业务数据与密钥材料 |
| 10 | [审计、指标、容量与故障排查](./10-审计指标容量与故障排查.md) | 运营和定位生产问题 |
| 11 | [备份、恢复、升级与灾难恢复](./11-备份恢复升级与灾难恢复.md) | 演练 Raft 恢复和升级 |
| 12 | [生产 Secret 平台综合项目](./12-生产Secret平台综合项目.md) | 串联应用、数据库、PKI 和交付平台 |

## 2. 核心原则

- Vault 保护 Secret，不会修复应用日志泄漏、过度授权和不安全构建。
- 认证证明“你是谁”，Policy 决定“你能做什么”，Secret Engine 才提供数据或凭据。
- Root Token 只用于初始化或紧急流程，不承担日常自动化。
- 动态凭据必须理解 Lease、续租和撤销；否则只是把静态密码换了存放位置。
- 备份必须与 Seal/自动解封密钥、配置和恢复权限共同设计。

## 3. 官方资料

- [Vault Documentation](https://developer.hashicorp.com/vault/docs)
