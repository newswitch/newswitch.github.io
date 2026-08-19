---
title: "HCL 类型、变量、Local 与 Output"
sidebar_label: "03. HCL、类型、变量与 Output"
sidebar_position: 3
description: "掌握 HCL 块、表达式、结构类型、变量校验、Local、Output、空值和敏感数据边界。"
tags: [HCL, Variable, Local, Output, Terraform]
---

# HCL 类型、变量、Local 与 Output

## 1. 输入接口

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"
  validation {
    condition     = contains(["test", "staging", "production"], var.environment)
    error_message = "environment is not allowed"
  }
}
```

变量定义类型、说明、默认值和校验。生产目标不使用危险默认值。

## 2. 结构类型

```hcl
variable "nodes" {
  type = map(object({
    size   = string
    zone   = string
    labels = map(string)
  }))
}
```

使用 Map/Object 表达稳定键，避免依赖列表顺序导致资源地址漂移。

## 3. Local

```hcl
locals {
  common_tags = {
    environment = var.environment
    managed_by  = "iac"
  }
}
```

Local 用于派生值，不是另一个可覆盖输入层。过度嵌套表达式会让 Plan 难以审查，应拆分并命名。

## 4. Output

```hcl
output "service_endpoint" {
  value       = module.service.endpoint
  description = "Endpoint consumed by deployment pipeline"
}
```

Output 是 Module/根配置接口。调用方不能依赖未声明的内部资源地址。

## 5. Sensitive

```hcl
variable "token" {
  type      = string
  sensitive = true
}
```

敏感标记主要控制 CLI/UI 展示传播，不保证值不会进入 State、Provider 日志、Crash Log 或下游 API。仍需 Backend 加密、访问控制和 Secret 引用。

## 6. Null 与 Unknown

`null` 表示省略/无值，Unknown 表示 Plan 时尚不能确定。不要用 Unknown 值决定需要在 Plan 阶段确定的 `for_each` 键集合。

## 7. 变量来源

团队明确变量文件、环境变量、CLI 和平台变量的优先级。含 Secret 的变量文件不进入 Git；Plan 制品和流水线日志同样受保护。
