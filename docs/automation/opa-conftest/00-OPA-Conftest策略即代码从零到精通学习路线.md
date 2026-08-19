---
title: "OPA / Conftest 策略即代码从零到精通学习路线"
sidebar_label: "00. OPA / Conftest 学习路线"
sidebar_position: 0
description: "从 OPA 决策模型与 Rego 开始，掌握测试、Bundle、决策日志、Conftest、Terraform/Kubernetes 策略和生产治理。"
tags: [OPA, Conftest, Rego, Policy as Code, DevSecOps, 学习路线]
---

# OPA / Conftest 策略即代码从零到精通学习路线

Open Policy Agent（OPA）是通用策略决策引擎：业务系统提供结构化输入，OPA 结合策略和外部数据返回决策。Conftest 将同一类 Rego 策略用于配置文件和 IaC 的离线/CI 测试。它们不是扫描器本身，而是把组织规则写成可版本、可测试、可审计的代码。

## 1. 学习顺序

| 阶段 | 文章 | 完成后能做什么 |
| --- | --- | --- |
| 1 | [策略即代码、OPA 架构与决策路径](./01-策略即代码OPA架构与决策路径.md) | 区分决策点、执行点和数据源 |
| 2 | [Rego v1 语法、规则与数据模型](./02-Rego-v1语法规则与数据模型.md) | 编写可解释策略 |
| 3 | [Input、Data、Undefined 与集合推导](./03-Input-Data-Undefined与集合推导.md) | 正确处理缺失、集合与外部数据 |
| 4 | [测试、覆盖率、调试与静态检查](./04-测试覆盖率调试与静态检查.md) | 为允许和拒绝路径建立回归测试 |
| 5 | [OPA API、Bundle、Discovery 与决策日志](./05-OPA-API-Bundle-Discovery与决策日志.md) | 运营生产决策服务 |
| 6 | [Conftest 解析器、Namespace 与输出](./06-Conftest解析器Namespace与输出.md) | 在本地和 CI 检查配置 |
| 7 | [Terraform/OpenTofu Plan 策略](./07-Terraform-OpenTofu-Plan策略.md) | 阻止危险基础设施变更 |
| 8 | [Kubernetes 清单与准入策略](./08-Kubernetes清单与准入策略.md) | 串联离线检查和集群准入 |
| 9 | [CI 门禁、等级、例外与渐进上线](./09-CI门禁等级例外与渐进上线.md) | 避免策略一次上线阻断全部交付 |
| 10 | [性能、Bundle 供应链与故障排查](./10-性能Bundle供应链与故障排查.md) | 控制延迟、分发和故障边界 |
| 11 | [多技术栈策略平台综合项目](./11-多技术栈策略平台综合项目.md) | 治理 Terraform、Kubernetes 和 CI 制品 |

## 2. 必须建立的边界

- OPA 返回决策；调用方或准入组件负责执行，执行点失败策略必须明确。
- `undefined` 不等于 `false`，缺失字段不能默认当合规。
- Conftest 检查的是渲染输入，不自动证明线上实际状态持续合规。
- Policy、基础数据、例外和 OPA/Conftest 版本都要可追溯。
- 安全策略需要阻断，成本/规范策略可先告警；等级由风险决定。

## 3. 官方资料

- [Open Policy Agent Documentation](https://www.openpolicyagent.org/docs/latest/)
- [Conftest Documentation](https://www.conftest.dev/)
