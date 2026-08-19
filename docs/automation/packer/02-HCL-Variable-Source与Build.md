---
title: "Packer HCL、Variable、Source 与 Build"
sidebar_label: "02. HCL、Variable、Source 与 Build"
sidebar_position: 2
description: "掌握 Packer HCL 模板、变量校验、Local、Source、Build、动态块和 Manifest。"
tags: [Packer, HCL, Variable, Source, Build]
---

# Packer HCL、Variable、Source 与 Build

## 1. 模板结构

```text
images/linux-base/
├── versions.pkr.hcl
├── variables.pkr.hcl
├── sources.pkr.hcl
├── build.pkr.hcl
├── scripts/
└── tests/
```

## 2. 变量

```hcl
variable "environment" {
  type = string
  validation {
    condition     = contains(["test", "production"], var.environment)
    error_message = "invalid environment"
  }
}
```

凭据不写默认值、不进入变量文件和命令历史。

## 3. Source

Source 定义 Builder 输入和平台参数，例如基础镜像过滤、实例规格、网络和输出名称。基础镜像过滤必须保证唯一并记录最终不可变 ID，不能只依赖“最新”名称。

## 4. Build

Build 引用一个或多个 Source，按顺序执行 Provisioner/Post-processor。不同平台共享业务步骤时仍要处理包管理、设备、云初始化和安全差异。

## 5. 校验

```bash
packer fmt -check .
packer init .
packer validate .
packer inspect .
```

Validate 不能证明云权限、网络和脚本执行成功，仍需测试构建。

## 6. Manifest

输出 Build ID、来源镜像、目标镜像 ID、时间、模板 Commit 和组件版本。Manifest 本身进入制品审计，不能只依赖终端日志。
