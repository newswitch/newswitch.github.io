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

## 7. 安全生成 Plan JSON

```bash
terraform init -lockfile=readonly
terraform plan -out=plan.bin
terraform show -json plan.bin > plan.json
conftest test plan.json --parser json --policy policy/terraform
```

`plan.bin` 与 JSON 都可能包含 Sensitive Value 或 Provider 返回的数据，必须使用受限 Artifact、短保留期和日志脱敏。不能把 Plan 提交进 Git，也不要在公共 CI 日志中执行完整 `jq .`。

## 8. Plan JSON 关键结构

| 字段 | 用途 |
| --- | --- |
| `resource_changes` | 每个资源地址与 Before/After Change |
| `change.actions` | Create、Update、Delete、Replace、No-op |
| `after_unknown` | Apply 才能确定的字段 |
| `before_sensitive`/`after_sensitive` | 敏感字段标记 |
| `configuration` | 模块、表达式和 Provider 配置线索 |
| `planned_values` | 展开后的预计资源状态 |

Provider 和 Terraform/OpenTofu 版本可能改变 Schema。测试夹具要覆盖真实版本，并在升级前生成决策差异报告。

## 9. Replace 不是普通 Update

Replace 常表示 `delete + create` 或 `create + delete`。对于数据库、IP、磁盘和负载均衡，它可能造成数据丢失、地址变化或中断。策略应读取 Action 组合，而不是只检查是否包含 `update`。

```rego
is_replace(actions) if {
  "delete" in actions
  "create" in actions
}
```

资源 Address 必须完整保留 Module、`count` 和 `for_each` 实例，才能定位真实爆炸半径。

## 10. Unknown 与 Sensitive

Unknown 不等于 Null，也不等于安全默认值。若生产数据库的 `publicly_accessible`、加密 Key 或删除保护到 Apply 才能确定，应阻断或提升审批，而不是因为没有看到 `true` 就通过。

Sensitive 标记只控制显示，不证明内容安全。策略通常不需要读取 Secret 值，只检查“是否来自受控引用”“是否声明敏感”和资源配置结构。

## 11. 汇总型策略

单资源规则看不出整体变更规模。可建立：

- 本次 Delete/Replace 总数；
- 同一 Region/AZ 被替换的比例；
- 生产数据库和磁盘清单；
- 预计公网入口数量；
- 关键资源跨地域迁移。

超过阈值时要求分批或更高审批。阈值来自系统容错能力，而不是随意数字。

## 12. 从 Plan 到 Apply 的证据链

```text
Commit + Variable Digest + Provider Lock
→ Plan Artifact Digest
→ Policy Revision + Result
→ Human Approval
→ Apply 相同 Plan Artifact
→ State/Cloud Drift Audit
```

Apply 身份无权绕过流水线重新 Plan；Artifact 下载和执行都要校验 Digest。否则 TOCTOU 使 Policy 检查失去意义。

## 13. 练习与答案

**问题：HCL 已通过 Conftest，为什么仍需检查 Plan JSON？**

答案：模块、变量、条件、Provider Default 和 `for_each` 展开后才得到真实资源变化。HCL 检查适合源码规范，Plan 检查才接近实际 Apply 对象。

**问题：`after` 中关键字段不存在，能否当作默认安全？**

答案：不能。先查看 `after_unknown`、Provider Schema 和默认语义；关键安全值未知时应拒绝或升级人工评审。

参考资料：

- [OPA Terraform use case](https://www.openpolicyagent.org/docs/terraform)
- [Conftest](https://www.conftest.dev/)
