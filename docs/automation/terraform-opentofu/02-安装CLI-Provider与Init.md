---
title: "Terraform/OpenTofu 安装、CLI、Provider 与 Init"
sidebar_label: "02. 安装、CLI、Provider 与 Init"
sidebar_position: 2
description: "建立固定 CLI、可信 Provider、版本约束、锁文件、镜像源和隔离实验环境。"
tags: [Terraform, OpenTofu, Provider, Init, Lock File]
---

# Terraform/OpenTofu 安装、CLI、Provider 与 Init

## 1. 验证 CLI

```bash
terraform version
terraform -help
terraform providers
```

通过官方分发或组织制品库安装并校验签名/Hash。CI 固定版本，不在运行时自动下载未知最新版本。

## 2. 版本约束

```hcl
terraform {
  required_version = ">= 1.8, < 2.0"
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}
```

示例版本只演示语法。真实约束根据所选 CLI/Provider 支持矩阵和测试制定。

## 3. Init

```bash
terraform init
terraform providers
```

Init 初始化 Backend、下载 Provider/Module 并更新依赖锁。`.terraform.lock.hcl` 通常进入 Git；`.terraform/` 工作目录不提交。

## 4. Provider 信任

- 固定来源和版本。
- 校验锁文件与平台 Hash。
- 使用组织镜像或允许列表。
- 不让不可信 PR 修改 Provider 来源后接触生产凭据。
- Provider 以进程方式运行，拥有当前任务的网络和凭据能力。

## 5. CLI 配置与凭据

CLI 配置、插件缓存、代理和凭据文件不提交仓库。CI 优先使用短期联合身份，避免长期云密钥环境变量泄漏到日志和 Plan。

## 6. 实验

先使用本地、随机或测试账号资源验证语义；不要以生产账号完成第一遍 `init/plan/apply`。实验结束前检查 State 和残留资源。

## 7. 常用只读检查

```bash
terraform fmt -check -recursive
terraform validate
terraform providers lock
terraform show
```

命令的副作用和参数随版本演进，执行前查阅所选 CLI 帮助。
