---
title: "Harbor 项目、RBAC、机器人账户与审计"
sidebar_label: "03. 项目、RBAC 与机器人账户"
sidebar_position: 3
description: "使用项目边界、用户组、机器人账户和审计日志隔离制品生产者、消费者与管理员。"
tags: [Harbor, RBAC, Robot Account, 审计, 安全]
---

# Harbor 项目、RBAC、机器人账户与审计

## 1. 项目是首要边界

Repository 位于 Project 中。项目可设置公开性、成员、配额、不可变规则、扫描和保留策略。通常按团队或信任域划分，而不是把所有镜像放进一个公共项目。

```text
platform-base   只允许平台流水线写
team-a-dev      Team A 开发制品
team-a-prod     受保护的生产制品
third-party     经过扫描的外部同步制品
```

## 2. 分离身份

| 身份 | 最小权限 |
| --- | --- |
| 开发者 | 开发项目读写，不拥有系统配置权 |
| CI 构建账户 | 指定项目 Push/Pull |
| 集群拉取账户 | 指定生产项目只读 |
| 复制账户 | 源项目读、目标项目写 |
| 平台管理员 | 系统配置；日常不用共享管理员账户 |

机器人账户适合非交互访问。为每条流水线或消费环境建立独立账户，设定作用域和有效期，便于撤销和归因。

## 3. 凭据生命周期

- 凭据由 Vault、CI Secret 或云密钥系统下发，不进入仓库和镜像层。
- 避免在命令参数、日志、调试输出中泄漏密码。
- 定期轮换；先添加新凭据并验证，再撤销旧凭据。
- 发现泄漏时撤销账户/Secret，并检查审计和异常 Push。
- Kubernetes 拉取 Secret 按 Namespace 隔离，限制 ServiceAccount 使用范围。

## 4. 审计问题

应能回答：谁在何时从哪个地址，对哪个 Repository 的哪个 Digest 执行了什么动作，动作是否成功，关联的是哪个 Pipeline/工单。

将 Harbor 审计日志集中保存，并与反向代理、CI、Kubernetes Admission 和业务发布事件按时间关联。仅保存应用日志不足以证明制品来源。

## 5. 权限验证

使用测试账户验证允许和拒绝路径：能否列举无权项目、覆盖生产 Tag、删除 Artifact、创建机器人账户或修改策略。权限测试应成为平台变更的回归用例。
