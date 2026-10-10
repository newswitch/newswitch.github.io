---
title: "Terraform/OpenTofu Module、环境、版本与复用"
sidebar_label: "07. Module、环境与版本"
sidebar_position: 7
description: "把 Module 设计成版本化基础设施接口，治理输入输出、Provider 传递、环境与 State 隔离、发布、升级和弃用。"
tags: [Terraform, OpenTofu, Module, Environment, Version]
---

# Terraform/OpenTofu Module、环境、版本与复用

Module 的价值不是减少文件数量，而是把一组同生命周期资源封装为有明确输入、输出、约束和升级策略的能力。坏 Module 会把复杂度藏起来，好 Module 会把风险显式化。

## 1. Root Module 与 Child Module

执行目录是 Root Module，它负责：

- Backend/State 边界；
- Provider 身份、区域和 Alias；
- 环境变量和 Module 组合；
- 最终 Output 与发布流程。

Child Module 被调用，负责一个可复用能力，例如 VPC、数据库实例或节点池。Child Module 不应决定生产账号凭据，也不应配置 Backend。

## 2. Module 应围绕生命周期划分

适合一个 Module 的资源通常：

- 由同一团队拥有；
- 经常一起创建、变更和销毁；
- 输入输出关系紧密；
- 具有相同安全与合规要求。

不要把“所有网络、计算、数据库、监控”塞进一个超级 Module。也不要为每个单资源包装一层、只改参数名字而没有策略价值。

```text
modules/
├── network/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── versions.tf
│   ├── README.md
│   ├── examples/
│   └── tests/
└── kubernetes-node-pool/
```

## 3. 输入接口设计

优先输入业务意图，而不是暴露 Provider 每一个参数：

```hcl
variable "node_pools" {
  type = map(object({
    instance_type = string
    min_size      = number
    max_size      = number
    labels        = optional(map(string), {})
  }))

  validation {
    condition = alltrue([
      for p in var.node_pools : p.min_size <= p.max_size
    ])
    error_message = "min_size must not exceed max_size"
  }
}
```

一串 Boolean 开关往往意味着 Module 同时承担多个互斥产品形态。应拆分 Module 或用清晰的对象类型表达模式。

高风险选项如公网暴露、删除保护关闭，不应拥有危险默认值。

## 4. Output 是稳定契约

```hcl
output "network" {
  value = {
    id         = example_network.main.id
    subnet_ids = { for k, v in example_subnet.app : k => v.id }
  }
}
```

不要输出整个资源对象或内部地址。调用方只依赖稳定字段，Module 才能在不破坏消费者的情况下调整内部实现。

改变 Output 名称、类型、Key 或 Sensitive 属性都属于接口变更，需要版本说明和迁移计划。

## 5. Provider 配置与 Alias

Child Module 声明 Provider 来源和最低/允许版本，不在内部硬编码账号凭据：

```hcl
terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.replica]
    }
  }
}
```

Root 显式传递：

```hcl
module "database" {
  source = "../../modules/database"
  providers = {
    aws         = aws
    aws.replica = aws.dr
  }
}
```

这样跨账号/区域关系可在 Plan 中审查，避免子 Module 隐式使用错误默认 Provider。

## 6. Module 来源与版本

常见来源包括 Registry、Git、对象存储和本地路径。生产来源必须不可变或可验证：

```hcl
module "network" {
  source  = "app.terraform.io/example/network/aws"
  version = "3.4.2"
}
```

Git 来源固定 Tag 或 Commit，并保护 Tag 不可重写。不要长期引用 `main` 分支，否则同一源码 Commit 在不同日期可能拉到不同 Module。

依赖锁文件通常锁 Provider，不完整锁定所有 Module；Module 版本仍需显式治理。

## 7. 语义化版本与兼容性

建议把下列变化视为破坏性候选：

- 变量删除、重命名或类型收紧；
- 默认值改变导致资源更新；
- Output 名称/类型改变；
- 资源地址或 `for_each` Key 改变；
- 最低 CLI/Provider 版本大幅提高；
- 生命周期从原地更新变成 Replace；
- 新增默认开启且有费用的资源。

即使只升级 Minor 版本，也必须看真实 Plan。语义化版本是承诺，不是技术强制。

## 8. 环境与 State 隔离

推荐生产、预生产、测试拥有独立 State、账号/项目和权限：

```text
live/
├── test/network/
├── staging/network/
└── production/network/
```

Workspace 只改变同一配置的 State 实例，不自动隔离 Backend 凭据、云账号和审批。如果环境具有不同 Owner、合规和发布节奏，独立 Root/State 通常更清楚。

不要用大量 `if environment == "prod"` 让一个 Root 同时承担完全不同的拓扑。

## 9. 跨 State 契约

跨 State 依赖可通过：

- 云 API/Data Source；
- 参数/配置服务；
- 版本化制品或配置文件；
- 受控 Remote State Output。

直接读取整个对方 State 会扩大敏感权限和内部耦合。Remote State 使用者往往需要访问完整 State，即使只读取一个 Output；应优先发布最小契约到权限更清晰的系统。

## 10. Module 测试层次

```text
fmt / validate
→ 变量校验和原生 test
→ Mock Provider 逻辑测试
→ 测试账号真实 Plan/Apply
→ 升级兼容测试
→ 销毁与残留检查
```

Mock 能验证表达式和属性，但无法发现云配额、最终一致、IAM、实际 API 默认和销毁失败。关键 Module 必须有真实集成测试。

## 11. 发布流程

一个可消费版本应包含：

- 不可变 Git Tag/Registry 版本；
- README、输入/输出和最小示例；
- CLI/Provider 兼容范围；
- 测试结果和安全扫描；
- Changelog、升级与回退说明；
- 已知 Replace/Destroy 风险；
- 弃用周期和维护 Owner。

示例必须真的由 CI 执行，避免文档和实现漂移。

## 12. 升级消费者

```text
阅读 Changelog
→ 单独提交版本变化
→ init -upgrade 更新依赖
→ 测试环境 Plan/Apply
→ 生产只读 Plan
→ 审查地址、Replace、默认值和 Output
→ Apply 与业务验收
```

不要在 Module 升级提交中同时重构调用方、升级多个 Provider 和修改业务参数，否则差异难以归因。

## 13. 弃用与迁移

先增加新变量/Output 并标记旧接口弃用，提供至少一个迁移周期；资源地址变化使用 `moved` 声明；必要时发布桥接版本。

Module 的历史 `moved` 块不要过早删除，因为跳过中间版本的消费者仍需迁移路径。何时清理应写入版本兼容政策。

## 14. 练习与答案

**问题：为什么“复用越多越好”是错误的？**

答案：为覆盖所有团队而设计的巨型 Module 会产生大量开关、动态块和互斥状态，升级爆炸半径更大。应复用稳定能力和策略，不必消灭简单重复。

**问题：Workspace 是否等于生产环境隔离？**

答案：不是。它主要隔离 State 实例，Backend、凭据、源码和权限仍可能共享。强安全边界应使用独立账号/项目、State 和流水线身份。

参考资料：

- [Terraform modules](https://developer.hashicorp.com/terraform/language/modules)
- [Terraform module syntax](https://developer.hashicorp.com/terraform/language/modules/syntax)
- [OpenTofu modules](https://opentofu.org/docs/language/modules/)
