---
title: "GitHub Actions Environment、审批与渐进式发布"
sidebar_label: "07. Environment 与发布"
sidebar_position: 7
description: "使用 Environment、保护规则、部署并发、不可变制品、健康门禁和 GitOps 完成可回滚发布。"
tags: [GitHub Actions, Environment, Deployment, GitOps, 渐进式发布]
---

# GitHub Actions Environment、审批与渐进式发布

## 1. Environment 的作用

Environment 为 `dev`、`staging`、`production` 等部署目标提供保护规则、审批、专属 Secret/Variable 和部署记录。Job 只有通过环境保护后才能获得该环境 Secret。

它是发布授权边界，不应只用于页面分类。

## 2. 构建与发布分离

```text
低权限构建
→ 测试/扫描/SBOM
→ 签名不可变 Digest
→ 候选制品
→ Environment 审批
→ 发布 Job 重新验证 Digest 与证明
→ 渐进部署和指标门禁
```

发布 Job 不重新从源码构建，避免审批的制品和实际部署的制品不同。

## 3. 并发和串行化

对同一环境设置并发组，避免两个生产发布交错。是否取消旧发布取决于操作语义：测试可以取消旧 Run，数据库迁移和生产滚动发布通常不能在未知阶段被强制替代。

使用稳定键 `application + environment`，不要让未经验证的分支名自由控制锁范围。

## 4. GitOps 边界

推荐 Workflow 生成并验证新 Digest，然后更新 GitOps 仓库；Argo CD 负责持续协调集群。Workflow 不持有长期 Cluster Admin，也不在发布后退出就失去漂移管理。

## 5. 渐进式发布

1. 记录部署前版本和回滚目标。
2. 先更新小流量/一个故障域。
3. 观察错误率、延迟、饱和度和业务指标。
4. 在有限窗口内自动推进或暂停。
5. 失败时回滚到已验证 Digest，并验证恢复。

审批人看到的材料要包含代码差异、制品 Digest、扫描/签名、变更范围、监控和回滚方案，不能只有“是否同意发布”。

## 6. 数据库变更

数据库迁移采用向前/向后兼容的 Expand-Contract，独立锁和备份验证。不要让 Job 重试直接重复不可幂等 DDL；超时后先查询实际 Schema/迁移表，再决定续跑或停止。
