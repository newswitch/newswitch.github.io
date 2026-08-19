---
title: "Backstage 认证、权限、RBAC 与多租户"
sidebar_label: "08. 认证、权限与多租户"
sidebar_position: 8
description: "接入 OIDC 身份，建立用户解析、Permission Policy、Catalog Ownership、服务身份与租户隔离。"
tags: [Backstage, OIDC, Permission Framework, RBAC, 多租户]
---

# Backstage 认证、权限、RBAC 与多租户

## 1. 认证不等于授权

OIDC/OAuth 证明用户身份；Sign-in Resolver 将外部身份映射为 Backstage User；Permission Policy 决定动作是否允许；外部系统还会再次授权。

```text
IdP Identity
→ Backstage User/Group
→ Permission Decision
→ Plugin Backend
→ External System Identity/Authorization
```

## 2. 身份映射

优先稳定唯一标识，不只按可变邮箱前缀匹配。无法唯一映射时拒绝登录并告警，不能自动绑定到同名账户。Group 同步有删除、重命名和嵌套规则。

## 3. Permission Policy

策略可结合 Permission、User Group、Entity Ownership 和环境。目录 Owner 是治理关系，不应自动等同生产管理员。高风险动作还需外部系统审批和最小身份。

前端权限仅改善体验，后端路由必须强制检查。

## 4. 服务间身份

插件间/后台任务使用短期服务凭据和明确 Audience，不共享管理员 Token。Secret 放入 Vault/External Secrets，日志只记录脱敏主体和决策。

## 5. 多租户

单实例共享目录适合统一组织，但要限制 Entity 可见性、TechDocs、搜索索引、模板、插件数据和外部集成。强隔离或法规场景可能需要独立实例/数据库/身份域。

## 6. Break-glass

紧急管理员使用独立 MFA 身份、短时授权和全量审计，不把本地超级管理员账号作为日常后门。IdP 故障和权限策略错误的恢复流程要演练。

## 7. 权限测试

针对匿名、普通用户、Owner、平台管理员和离职用户测试：查看实体/文档、运行模板、访问插件数据、执行动作和调用后端 API。拒绝路径纳入回归测试。
