---
title: "GitLab CI Environment、Review App、审批与发布"
sidebar_label: "06. Environment、审批与发布"
sidebar_position: 6
description: "管理环境记录、Review App、手工门禁、保护环境、Resource Group、渐进式发布和停止动作。"
tags: [GitLab CI, Environment, Review App, Deployment, Approval]
---

# GitLab CI Environment、Review App、审批与发布

## 1. Environment

Environment 记录部署目标和历史，不自动提供隔离。测试、预生产和生产仍需独立账号、Namespace、凭据和权限。

## 2. Review App

按合并请求创建临时环境，名称和域名使用安全 Slug。设置最长生命周期、配额、自动停止和孤儿清理；外部 PR 不得到生产网络。

## 3. 手工 Job

人工点击不是完整审批。需要显示版本、Digest、目标、差异、风险和回退，并限制谁能执行保护环境部署。

## 4. Resource Group

同一环境串行发布，防止旧 Pipeline 覆盖新版本。目标系统也校验期望版本。

## 5. 渐进式

```text
测试
→ 金丝雀
→ SLO 观察
→ 小批次
→ 全量
```

每阶段有停止条件和自动/人工晋级规则。部署成功后执行业务验收。

## 6. Stop

Review App Stop Job 必须幂等，资源不存在视为完成；生产环境 Stop/Destroy 采用独立高风险审批和数据保护。
