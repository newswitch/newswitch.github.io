---
title: "Terraform/OpenTofu Module、环境、版本与复用"
sidebar_label: "07. Module、环境与版本"
sidebar_position: 7
description: "设计输入输出稳定的小型 Module，隔离环境和 State，并治理来源、版本、升级与弃用。"
tags: [Terraform, OpenTofu, Module, Environment, Version]
---

# Terraform/OpenTofu Module、环境、版本与复用

## 1. Module 是配置接口

一个 Module 应表达一个生命周期清晰的能力，例如网络、节点池或数据库实例，而不是把整个公司基础设施封装为巨型黑盒。

```text
modules/service/
├── main.tf
├── variables.tf
├── outputs.tf
├── versions.tf
├── README.md
└── tests/
```

## 2. 接口设计

- 输入有类型、说明、校验和安全默认值。
- Output 只暴露调用方真正需要的稳定字段。
- 不让调用方依赖内部资源地址。
- Secret 使用引用或短期身份，避免普通明文变量。
- 可选功能不制造难以理解的条件树。

## 3. 环境隔离

```text
live/
├── test/
├── staging/
└── production/
```

环境使用独立 State、账号和权限。Workspace 可以提供实例隔离，但不会自动隔离凭据、Backend 和代码逻辑；是否适合取决于组织边界。

## 4. Module 版本

远程 Module 固定版本或 Commit。升级一次只跨合理范围，审查 Changelog、Plan 和迁移。不要永久引用可变主分支。

## 5. Provider 传递

根 Module 负责配置 Provider 和身份，子 Module 声明需求。多账号/区域使用显式 Alias 传递，避免隐式选错生产账号。

## 6. 复用边界

复用业务能力，不追求消灭每一行重复。过度通用 Module 会产生大量 Boolean、Dynamic Block 和互斥参数，Plan 难以理解。

## 7. 发布门禁

Module 发布需通过格式、Validate、测试、示例 Plan、文档和兼容检查。版本关联 Git Tag 和不可变来源。
