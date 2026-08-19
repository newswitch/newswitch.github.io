---
title: "策略即代码、OPA 架构与决策路径"
sidebar_label: "01. OPA 架构与决策路径"
sidebar_position: 1
description: "理解 Policy Decision Point、Policy Enforcement Point、Input、Data、Bundle 和 Decision Log 的完整关系。"
tags: [OPA, Policy as Code, PDP, PEP, 架构]
---

# 策略即代码、OPA 架构与决策路径

## 1. 为什么需要独立策略层

当权限、合规、成本和安全规则散落在 Shell、Terraform、Admission Webhook 和业务代码中，同一规则会产生多份实现且难以测试。策略即代码把规则与业务动作分离，并进入 Git 评审和自动测试。

## 2. PDP 与 PEP

```text
请求/资源/变更
→ PEP（CI、API 网关、Admission、业务服务）构造 Input
→ OPA PDP 读取 Policy + Data 求值
→ 返回 allow/deny/reasons/metadata
→ PEP 执行允许、拒绝、告警或降级
```

OPA 是 Policy Decision Point；真正阻止 Terraform Apply 或 Kubernetes 创建的是 Policy Enforcement Point。若调用方忽略 OPA 返回值，策略不会自动生效。

## 3. 决策输入

好的 Input 是稳定、最小、可测试的 JSON Schema。例如部署决策可包含镜像 Digest、Namespace、ServiceAccount、资源请求和变更身份，而不是把整个不稳定平台对象直接暴露给所有规则。

敏感字段不应进入 Input 和决策日志，除非策略确实需要并已配置脱敏。

## 4. 策略与数据

| 对象 | 示例 | 生命周期 |
| --- | --- | --- |
| Policy | 生产镜像必须按 Digest | 随规则版本发布 |
| Base Data | 允许仓库、环境分级、团队映射 | 独立更新，可由 Bundle 分发 |
| Input | 本次 Pod/Plan/请求 | 每次决策变化 |
| Decision | allow、deny reasons | 用于执行与审计 |

不要把频繁变化的团队列表硬编码进 Rego，也不要把核心安全语义全部放进无评审的外部数据。

## 5. 失败策略

- 核心安全准入通常 Fail Closed，但要保证 OPA 高可用和应急路径。
- 只读审计、成本建议可 Fail Open 并告警。
- CI 本地策略缺失、Bundle 校验失败不应静默视为通过。
- 应急豁免必须有范围、责任人、理由和到期时间。

## 6. 可审计决策

记录策略/Bundle Revision、Input 摘要、Query、Decision ID、结果、命中规则、调用方和时间。日志足以复现判断，但不泄漏完整 Secret 或个人数据。
