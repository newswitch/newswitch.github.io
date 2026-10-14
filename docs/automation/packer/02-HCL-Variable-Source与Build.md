---
title: "Packer HCL、Variable、Source、Build 与 Manifest"
sidebar_label: "02. HCL、Variable、Source 与 Build"
sidebar_position: 2
description: "掌握 Packer HCL 模板加载、变量与敏感值、Data Source、Source、Build、条件执行、Post-processor 和 Manifest。"
tags: [Packer, HCL, Variable, Source, Build, Manifest]
---

# Packer HCL、Variable、Source、Build 与 Manifest

Packer HCL 与 Terraform 都使用 HCL2，但资源模型不同。Packer 没有 Terraform State 和持续资源生命周期，它描述的是一次镜像构建流水线。

## 1. 模板目录如何加载

```text
images/linux-base/
├── versions.pkr.hcl
├── variables.pkr.hcl
├── data.pkr.hcl
├── sources.pkr.hcl
├── build.pkr.hcl
├── scripts/
├── ansible/
└── tests/
```

对目录执行命令时，Packer 会组合其中的 `*.pkr.hcl` 模板文件。文件名用于组织，不应用来表达执行顺序；Provisioner 顺序写在 `build` 中。

变量值文件使用 `*.pkrvars.hcl`，自动加载文件使用 `*.auto.pkrvars.hcl`。敏感变量文件不进入 Git。

## 2. 输入变量与校验

```hcl
variable "architecture" {
  type        = string
  description = "Target CPU architecture"
  default     = "amd64"

  validation {
    condition     = contains(["amd64", "arm64"], var.architecture)
    error_message = "architecture must be amd64 or arm64"
  }
}
```

生产账号、区域、基础镜像 ID、KMS Key 等高风险输入不应拥有误导性的默认值。校验应尽量在调用云 API 前失败。

变量来源可包括文件、环境和 CLI：

```bash
packer validate -var-file=env/test.pkrvars.hcl .
packer build -var-file=env/test.pkrvars.hcl .
```

命令行参数可能进入进程列表和 CI 日志，Secret 不应直接写在 `-var` 中。

## 3. Local 与 Sensitive

普通派生值：

```hcl
locals {
  image_name = "linux-${var.architecture}-${formatdate("YYYYMMDD-hhmm", timestamp())}"
}
```

Packer 还支持可标记 Sensitive 的单个 `local` 块，用于隐藏日志展示：

```hcl
local "repo_token" {
  expression = vault("secret/data/image", "token")
  sensitive  = true
}
```

Sensitive 主要过滤 UI/日志显示，不保证值没有进入 Guest、脚本参数、进程环境、临时文件或最终镜像。Secret 设计仍以“不写入镜像”为原则。

## 4. Data Source 与不可变输入

Data Source 可查询基础镜像，但动态筛选存在漂移：

```text
owner + name pattern + most_recent=true
```

同一 Commit 在不同日期可能选中不同镜像。推荐流程：

```text
发现任务按可信发布者筛选候选
→ 安全验证与审批
→ 把不可变 Image ID 写入版本化目录
→ Packer Build 只消费已批准 ID
```

如果构建时仍使用动态筛选，Manifest 必须记录最终解析出的 ID、发布者和时间，并防止零个或多个不确定结果。

## 5. Source 块

```hcl
source "amazon-ebs" "base" {
  region        = var.region
  source_ami    = var.base_ami_id
  instance_type = var.builder_instance_type
  ssh_username  = var.ssh_username
  ami_name      = local.image_name

  tags = {
    BuildCommit = var.git_commit
    BuildId     = var.build_id
    Status      = "candidate"
  }
}
```

Source 应完整表达构建环境：基础镜像、架构、规格、网络、磁盘、加密、Communicator 和目标名称。不要在 Source 中嵌入长期云凭据，使用 Runner 的短期身份。

## 6. Build 块与 Source 选择

```hcl
build {
  name = "linux-base"

  sources = [
    "source.amazon-ebs.base"
  ]

  provisioner "shell" {
    script = "scripts/bootstrap.sh"
  }
}
```

一个 Build 引用多个 Source 时，Provisioner 通常会对每个 Builder 执行。使用 `only`、`except` 或条件逻辑前确认匹配的是 Build/Source 名称，避免某个平台跳过安全步骤。

命令行也可选择：

```bash
packer build -only='linux-base.amazon-ebs.base' .
```

选择性构建适合调试，不应让生产发布遗漏必须的测试或 Post-processor。

## 7. Provisioner 顺序与错误语义

Provisioner 按声明顺序运行：

```text
等待 Guest 初始化
→ 基础配置
→ 安装软件
→ 重启
→ 验证
→ 清理
```

某一步失败通常会终止当前构建并进入清理。脚本必须正确返回非零退出码；`curl` 下载失败但脚本继续返回 0，会生成“成功”的坏镜像。

## 8. Post-processor 链

单个 Post-processor 通常都接收 Builder Artifact；`post-processors` 链允许前一个输出交给后一个：

```hcl
build {
  sources = ["source.qemu.base"]

  post-processors {
    post-processor "checksum" {
      checksum_types     = ["sha256"]
      keep_input_artifact = true
    }
  }
}
```

输入 Artifact 默认是否保留、链式执行和并行关系需要按具体 Post-processor 文档确认。错误配置可能在生成校验文件后删除原产物。

## 9. Manifest

```hcl
post-processor "manifest" {
  output     = "artifacts/manifest.json"
  strip_path = true
  custom_data = {
    git_commit   = var.git_commit
    base_image   = var.base_ami_id
    packer_build = var.build_id
  }
}
```

Manifest 记录 Build 名称、Builder 类型、Artifact ID、时间和自定义数据。它不是完整软件物料清单，也不自动证明测试或签名通过。

推荐将以下证据关联：

```text
Packer Manifest
+ SBOM
+ 漏洞扫描结果
+ 测试报告
+ 基础镜像证明
+ Packer/Plugin 精确版本与 Hash
+ Git Commit
+ 晋级状态
```

## 10. 格式、初始化、校验与检查

```bash
packer fmt -check .
packer init .
packer validate -var-file=env/test.pkrvars.hcl .
packer inspect .
```

`validate` 能检查模板与 Plugin Schema，但不会证明：云权限足够、基础镜像存在、网络可达、Guest 能启动或 Provisioner 能成功。真实构建和启动测试不可省略。

## 11. 构建可重复性的敌人

- `latest` 基础镜像和未固定包版本；
- 构建时直接访问滚动公网脚本；
- 时间、随机数参与软件选择而不记录；
- Plugin 宽版本约束却不保存实际版本；
- 包仓库元数据随时间变化；
- Provisioner 根据外部环境走不同分支；
- 多平台共享脚本却没有平台断言。

镜像名称包含时间戳有助于唯一性，但不能作为可重复性的证据。

## 12. 练习与答案

**问题：`packer validate` 通过，为什么 Build 仍可能在 30 分钟后失败？**

答案：Validate 主要检查 HCL 和 Plugin Schema；真实构建还依赖云 API、配额、网络、Guest 启动、软件仓库、脚本和快照。

**问题：Manifest 能否替代 SBOM？**

答案：不能。Manifest 记录 Packer Artifact 和自定义元数据；SBOM 描述镜像内软件组件、版本和依赖。二者应关联但职责不同。

参考资料：

- [Packer HCL templates](https://developer.hashicorp.com/packer/docs/templates/hcl_templates)
- [Packer build block](https://developer.hashicorp.com/packer/docs/templates/hcl_templates/blocks/build)
- [Packer manifest post-processor](https://developer.hashicorp.com/packer/docs/post-processors/manifest)
