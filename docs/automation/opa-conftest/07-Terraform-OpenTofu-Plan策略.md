---
title: "Terraform/OpenTofu Plan 策略"
sidebar_label: "07. Terraform/OpenTofu 策略"
sidebar_position: 7
description: "对 Plan JSON 的资源变化、敏感属性、删除替换、成本标签和网络边界实施 Conftest/OPA 门禁。"
tags: [OPA, Conftest, Terraform, OpenTofu, Plan]
---

# Terraform/OpenTofu Plan 策略

## 1. 为什么检查 Plan 而非只检查 HCL

HCL 是模块和表达式源码，Plan JSON 才包含变量、Provider、Module 展开后的预期变化。策略通常需要知道资源地址、Change Actions、Before/After、Unknown 和 Sensitive 信息。

```text
terraform/tofu plan -out=<planfile>
→ show -json
→ Conftest/OPA
→ 人工评审 + Policy Result
→ Apply 同一个已批准 Plan
```

不要在文章示例或 CI 中提交二进制 Plan；它可能包含敏感值，应使用受限 Artifact 和短保留期。

## 2. Change Actions

策略必须区分 Create、Update、Delete、Replace 和 No-op。删除生产数据库、替换关键负载均衡或大规模变更需要更高审批；并非所有资源都只检查 `after`。

Unknown 表示 Apply 才能确定，不能简单当空值合规。对于关键约束，可要求值在 Plan 阶段已知，否则阻断或升级人工评审。

## 3. 策略示例维度

- 公网入口只允许经过审批的端口与来源；
- 对象存储启用加密、版本和公共访问阻断；
- 数据库删除保护、备份和高可用满足环境等级；
- 资源包含 Owner、Environment、CostCenter 标签；
- Provider 和 Module 来源、版本满足允许列表；
- 单次删除/替换数量不超过爆炸半径；
- 生产实例规格和地域只能来自批准集合。

## 4. Module 与资源定位

违规结果包含 Resource Address、Module Address、类型、变更动作和字段路径，便于开发者定位源码。对 `for_each`/`count` 实例不能只显示资源类型。

## 5. 策略无法替代什么

Plan Policy 不替代云 IAM、组织级 Service Control Policy、预算告警、State 锁和人工架构评审。它在 Apply 前发现可见风险，但 Apply 后仍需漂移和实际状态审计。

## 6. TOCTOU 防护

审核后 Apply 必须使用同一 Plan Artifact、同一代码/变量/Provider Lock 和可信执行身份。若重新 Plan，策略结果和审批必须重新产生，防止检查对象与执行对象不同。
