---
title: "Terraform/OpenTofu 安装、CLI、Provider 与 Init"
sidebar_label: "02. 安装、CLI、Provider 与 Init"
sidebar_position: 2
description: "建立可复现的 CLI、Provider、Module 和 Backend 初始化过程，理解插件信任、锁文件、多平台 Hash、镜像与凭据边界。"
tags: [Terraform, OpenTofu, Provider, Init, Lock File]
---

# Terraform/OpenTofu 安装、CLI、Provider 与 Init

`init` 看似只是下载插件，实际完成 Backend 初始化、Module 获取、Provider 解析与依赖锁定。它决定后续 Plan 使用哪些代码和把 State 写到哪里，因此属于供应链和生产安全边界。

## 1. 固定 CLI 来源和版本

从官方发行渠道或组织制品库安装，并验证签名/校验和：

```bash
terraform version
terraform -help
```

OpenTofu：

```bash
tofu version
tofu -help
```

本地、CI 和远程执行平台应使用同一受测版本。不要让流水线每次自动下载“latest”，否则相同 Commit 可能生成不同 Plan。

版本管理器能提高切换效率，但仍需锁定下载源和校验值。CLI 二进制也有读取源码、State 和云凭据的能力，不能把来历不明的包装脚本视为普通工具。

## 2. `required_version` 与 Provider 约束

```hcl
terraform {
  required_version = ">= 1.8, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

示例版本仅表达语法。`~> 5.0` 允许 5.x 更新，但是否适合自动升级要结合 Provider 兼容策略和测试。生产 Module 通常声明合理范围，根配置通过锁文件选择确切版本。

`required_version` 约束 CLI；`required_providers` 约束 Provider 来源和版本。两者不能相互替代。

## 3. Provider 为什么风险很高

Provider 是独立可执行插件，通常继承当前进程的环境变量、网络和云凭据，并能调用外部 API。一个恶意或被替换的 Provider 不只是生成错误 Plan，还可能读取 Secret 或直接访问账号资源。

治理要求：

- 固定完整 Source Address 和版本；
- 审查 `.terraform.lock.hcl` 的来源与 Hash 变化；
- 仅允许可信 Registry/内部镜像；
- 不让不可信 PR 在持有生产凭据的 Runner 上执行 `init/plan`；
- Provider 升级单独提交并审查 Changelog 与 Plan。

## 4. `terraform init` 做了什么

```bash
terraform init
```

大致过程：

```text
读取 Backend 配置
→ 初始化或迁移 State Backend
→ 解析 Module 来源与版本
→ 求解 Provider 版本
→ 下载/校验 Provider 插件
→ 写入或校验依赖锁文件
→ 准备 .terraform 工作目录
```

`.terraform/` 是当前工作目录缓存，通常不提交 Git；`.terraform.lock.hcl` 应提交，以便团队使用同一 Provider 选择。

## 5. Lock File 的真实边界

锁文件记录选定 Provider 版本和校验 Hash，但不锁定 Module 版本，也不锁定 CLI。远程 Module 必须在 Source 中固定版本/Tag/Commit。

多平台团队应预先加入目标平台 Hash，例如：

```bash
terraform providers lock \
  -platform=linux_amd64 \
  -platform=linux_arm64 \
  -platform=windows_amd64
```

这能减少开发机更新锁文件后 Linux CI 无法验证包的问题。Hash 变化必须先确认是官方重签、来源变化还是供应链异常，而不是直接删除锁文件。

## 6. Backend 初始化与迁移

Backend 决定 State 位置和锁语义。常见命令：

```bash
terraform init -reconfigure
terraform init -migrate-state
```

`-reconfigure` 重新使用当前配置，不迁移已有 State；`-migrate-state` 涉及状态迁移。执行前应：

1. 确认当前和目标 Backend/Workspace；
2. 冻结 Apply 并备份 State；
3. 验证目标加密、锁、版本和权限；
4. 在副本演练；
5. 迁移后对比 `state list` 并运行只读 Plan。

不要把 Backend 凭据或动态值硬编码在配置中。通过工作负载身份、受保护环境变量或安全配置注入。

## 7. Provider 与 Module 镜像

受限网络或大规模 CI 可使用 Provider Network Mirror/Filesystem Mirror 和内部 Module Registry。目的包括：

- 固定允许来源；
- 降低公网依赖和限流；
- 保留已批准版本；
- 提供审计和恶意包扫描。

镜像不是简单缓存。必须同步校验信息、控制发布权限并定义上游撤回/漏洞版本的处置策略。

CLI 配置文件可声明安装策略，凭据与代理配置不得提交仓库。不同 CLI 的配置路径和语法应查目标版本文档。

## 8. Provider 配置与别名

```hcl
provider "aws" {
  region = var.region
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region
}
```

根 Module 负责 Provider 身份和区域，子 Module 声明需求并显式接收 Alias。隐式继承在多账号环境中容易把资源创建到错误账号。

在 Plan 开始前输出经过脱敏的账号、区域和 Backend 标识，建立“我要改哪里”的硬门禁。

## 9. 凭据生命周期

优先使用 OIDC/工作负载身份获取短期凭据：

```text
CI Job 身份
→ 身份提供商验证
→ 云 STS 签发短期 Role
→ Provider 使用临时凭据
```

避免长期 Access Key、明文变量文件和命令行 Secret。Plan 阶段也会运行 Provider/Data Source，不能因为“不 Apply”就给它不受控的只读账号或把不可信代码带入凭据环境。

## 10. 离线和代理排障

`init` 失败按层检查：

```text
DNS/TCP/TLS
→ HTTP Proxy/NO_PROXY
→ Registry Discovery
→ Provider/Module Source
→ 版本约束是否有交集
→ Lock Hash 与当前平台
→ 插件目录权限/杀毒软件
→ Backend 认证与网络
```

常见错误“没有可用版本”可能是多个 Module 对 Provider 的约束无交集，不一定是网络问题。使用：

```bash
terraform providers
```

查看约束来自哪个 Module。

## 11. 初始化验收

```bash
terraform fmt -check -recursive
terraform init -lockfile=readonly
terraform validate
terraform providers
```

CI 的日常 Plan 可用只读锁文件，阻止运行时悄悄改版本；升级任务则显式更新并评审锁文件。

## 12. 练习与答案

**问题：为什么从 Fork 提交的 PR 不能直接使用生产只读凭据运行 Plan？**

答案：HCL 可引入恶意 Provider/Module，Data Source 和外部执行也可能利用凭据或网络。Plan 不是纯静态操作；应先在无凭据环境做静态检查，再由受信代码和受控 Runner 生成生产 Plan。

**问题：删除 `.terraform.lock.hcl` 能否解决 Provider 校验失败？**

答案：可能暂时绕过症状，但会失去已审查版本和 Hash。应先确认目标平台 Hash、镜像来源、包完整性和锁文件修改原因，再执行受控升级。

参考资料：

- [Terraform init](https://developer.hashicorp.com/terraform/cli/commands/init)
- [Terraform dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock)
- [OpenTofu providers](https://opentofu.org/docs/language/providers/)
