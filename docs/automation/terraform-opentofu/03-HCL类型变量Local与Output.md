---
title: "HCL 类型、变量、Local、Output 与敏感值"
sidebar_label: "03. HCL、类型、变量与 Output"
sidebar_position: 3
description: "掌握 HCL 求值、结构类型、变量校验、Local、Output、Null、Unknown、Sensitive 与临时值，设计稳定的 Module 接口。"
tags: [HCL, Variable, Local, Output, Terraform]
---

# HCL 类型、变量、Local、Output 与敏感值

HCL 看起来像配置文件，实际包含类型系统、表达式求值、未知值传播和 Module 接口。很多危险 Replace 或 Plan 阶段错误，并不是 Provider 问题，而是地址键与值的建模错误。

## 1. 块、参数和表达式

```hcl
resource "example_server" "api" {
  name = "api-${var.environment}"

  labels = merge(local.common_labels, {
    role = "api"
  })
}
```

`resource` 是块，`example_server`/`api` 是标签，`name` 是参数，右侧是表达式。HCL 文件名通常不影响求值顺序，不能靠 `01-main.tf` 保证资源先创建；顺序来自引用形成的依赖图。

## 2. 原始类型与结构类型

常用原始类型：`string`、`number`、`bool`。集合类型：

```hcl
list(string)
set(string)
map(string)
tuple([string, number])
object({
  size    = string
  zone    = string
  enabled = optional(bool, true)
  labels  = optional(map(string), {})
})
```

List 有顺序且可重复；Set 无顺序且唯一；Map 以稳定字符串键访问。资源集合优先使用稳定业务键的 Map，而不是依赖 List 下标。

## 3. 变量是公开接口

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"
  nullable    = false

  validation {
    condition     = contains(["test", "staging", "production"], var.environment)
    error_message = "environment must be test, staging, or production"
  }
}
```

变量应有准确类型、说明、校验和安全默认值。生产目标、区域、删除开关等高风险输入不要给“方便”的默认值。

校验错误应告诉调用者如何修复，而不是只写 `invalid value`。

## 4. `null`、缺省与空集合

`null` 通常表示未提供/省略，让 Module 或 Provider 选择默认；`""`、`[]`、`{}` 是明确的空值。三者语义可能不同。

```hcl
variable "description" {
  type     = string
  default  = null
  nullable = true
}
```

把 `null` 强制转成空字符串可能让 Provider 不断产生 Diff。接口应明确：调用者不设置、设置为空和设置具体值分别意味着什么。

## 5. Unknown 值与 Plan 阶段

Unknown 表示值要到 Apply 才能确定，Plan 常显示 `(known after apply)`。Unknown 不是 `null`。

```hcl
resource "example_server" "node" {
  for_each = var.nodes
  subnet_id = example_subnet.app.id
}
```

`subnet_id` 的值可以未知，因为资源实例地址已经由 `var.nodes` 确定；但 `for_each` 的键集合必须在 Plan 时已知，否则 Core 无法知道图中有几个实例。

因此不要使用新资源生成的随机 ID 作为 `for_each` Key。用稳定业务键做地址，把未知 ID 仅作为属性值。

## 6. `for`、`for_each` 与 `dynamic`

```hcl
locals {
  enabled_nodes = {
    for name, node in var.nodes : name => node
    if node.enabled
  }
}
```

`for` 变换值，`for_each` 创建多个资源实例，`dynamic` 生成重复嵌套块。过度使用多层 `dynamic` 会让 Plan 难以阅读；如果数据模型比目标 API 更复杂，应重新设计 Module 接口。

资源地址一旦进入 State，Key 就成为生命周期身份。把 Key 从 `node-a` 改为 `0` 不是普通重命名，需要 `moved` 等迁移。

## 7. Local 的职责

```hcl
locals {
  common_labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  resource_name = "${var.service}-${var.environment}"
}
```

Local 用于命名中间表达式、统一派生规则，不是另一个输入层。一个 Local 链接十几层会让 Unknown 和错误难以追踪，应按业务语义拆分。

使用 `terraform console` 在不 Apply 的情况下检查纯表达式：

```bash
terraform console
> merge({a = 1}, {b = 2})
```

控制台可能读取 State 和变量，输出仍需脱敏。

## 8. Output 是契约

```hcl
output "service" {
  description = "Stable service contract"
  value = {
    endpoint = example_service.main.endpoint
    id       = example_service.main.id
  }
}
```

Output 应暴露调用者真正需要的稳定信息，不要输出整个资源对象，否则 Provider 新增属性也可能扩大耦合和敏感数据暴露。

根 Module Output 会进入 State。`terraform output -json` 适合机器读取，但可能显示 Sensitive 值，流水线日志必须保护。

## 9. Sensitive 只控制展示传播

```hcl
variable "api_token" {
  type      = string
  sensitive = true
}
```

`sensitive` 会隐藏部分 CLI/UI 展示并传播敏感标记，但值仍可能位于 State、Plan、Provider 内存、Debug 日志和远端 API。它不是加密，也不是“不落盘”。

Secret 优先用短期身份或 Provider 支持的临时/Write-only 能力。Terraform 的 Ephemeral 值、OpenTofu 的 State/Plan 加密等功能具有版本和 Provider 前提，启用前必须验证兼容、失败恢复和密钥生命周期。

## 10. Ephemeral 与持久值边界

Ephemeral 资源用于操作期间临时存在且不写入 State/Plan 的值，例如短期凭据。它并不意味着所有引用位置都允许临时值；持久资源若必须把某值保存为状态，Core 会拒绝或 Provider 需要提供 Write-only 参数。

使用前回答：

- CLI 和 Provider 版本是否支持；
- 临时凭据在长 Apply 中如何续租；
- Apply 恢复时是否能重新获取；
- 下游资源 Read 是否需要原值；
- 失败日志是否仍泄露。

## 11. 变量来源与优先级

变量可来自默认值、变量文件、自动加载文件、环境变量和 CLI 参数。团队应固定规则，避免本地成功、CI 使用另一组值。

建议：

- 非敏感环境配置使用受评审变量文件；
- Secret 由凭据系统动态注入；
- 生产 Plan 保存变量来源摘要；
- 禁止在命令行直接写 Secret，因为进程列表和流水线日志可能记录；
- 不把 `*.tfvars` 一概忽略，应区分可提交配置和敏感文件。

## 12. Preconditions、Postconditions 与 Check

变量 Validation 检查输入；资源 Preconditions/Postconditions 检查资源前后条件；Check 可做持续或附加验证。应把“永远不允许”的条件放在执行路径中，把外部系统暂时不可用的检查设计成不会无意阻塞紧急恢复。

```hcl
lifecycle {
  precondition {
    condition     = var.replica_count >= 3
    error_message = "production requires at least three replicas"
  }
}
```

具体能力随 CLI 版本演进，Module 应声明最低版本。

## 13. 练习与答案

**问题：为什么 `for_each = toset(resource.items[*].id)` 常在 Plan 阶段失败？**

答案：新资源 ID 在 Apply 后才知道，Core 无法在 Plan 阶段确定实例地址集合。应使用配置中的稳定 Key 创建 Map，把 ID 作为实例属性。

**问题：Output 标记 Sensitive 后，State 是否安全？**

答案：否。标记主要控制展示，State 仍可能保存明文。需要 Backend 加密、最小权限、审计和 Secret 生命周期治理；OpenTofu 原生加密还需正确管理密钥和迁移。

参考资料：

- [Terraform type constraints](https://developer.hashicorp.com/terraform/language/expressions/type-constraints)
- [Terraform values](https://developer.hashicorp.com/terraform/language/expressions/types)
- [Terraform ephemeral blocks](https://developer.hashicorp.com/terraform/language/block/ephemeral)
- [OpenTofu state and plan encryption](https://opentofu.org/docs/language/state/encryption/)
