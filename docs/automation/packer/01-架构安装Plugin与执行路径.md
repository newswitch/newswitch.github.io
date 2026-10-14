---
title: "Packer 架构、安装、Plugin 与执行路径"
sidebar_label: "01. 架构、安装与 Plugin"
sidebar_position: 1
description: "沿 Packer Core、Plugin、Source、Builder、Communicator、Provisioner、Post-processor 与 Artifact 解释一次镜像构建的完整执行路径。"
tags: [Packer, Plugin, Builder, Communicator, Provisioner, Architecture]
---

# Packer 架构、安装、Plugin 与执行路径

Packer 不是虚拟化平台，也不直接运行生产实例。它协调云或虚拟化 API 创建临时构建机，在其中完成配置，再把磁盘或实例固化为不可变镜像产物。

## 1. 一次构建的完整路径

```text
Packer HCL Template
  → Core 解析变量、Source、Build
  → 加载并启动 Plugin 进程
  → Builder 调用目标平台 API
  → 创建临时实例、磁盘、网络与临时凭据
  → Communicator 等待 SSH/WinRM
  → Provisioner 安装、配置、重启与清理
  → Builder 停止临时实例并生成镜像/快照
  → Post-processor 处理 Artifact
  → Manifest 记录镜像 ID 和元数据
  → 清理临时资源
```

“构建成功”只说明 Builder 产出了 Artifact，不等于新实例能够启动、业务能够运行或镜像中没有 Secret。测试和晋级是后续独立阶段。

## 2. 核心组件

| 组件 | 职责 | 故障例子 |
| --- | --- | --- |
| Core/CLI | 解析模板、变量求值、调度 Build | HCL/变量错误 |
| Plugin | 向 Core 提供平台能力 | 版本、来源、进程崩溃 |
| Data Source | 在构建前读取外部数据 | 基础镜像过滤返回多个结果 |
| Source | 描述可复用 Builder 配置 | 网络、规格、基础镜像错误 |
| Builder | 创建临时环境并产出 Artifact | IAM、配额、快照失败 |
| Communicator | 通过 SSH/WinRM 连接 Guest | 路由、用户、Host Key、启动未完成 |
| Provisioner | 在 Guest 或构建机执行配置 | 包锁、脚本、重启、Secret 泄漏 |
| Post-processor | 对产物复制、打包或生成元数据 | 链顺序、输入 Artifact 被删除 |
| Artifact | Builder/Post-processor 的输出 | 镜像 ID、文件、快照集合 |

Plugin 通常是独立可执行进程，继承构建任务的网络和权限。它不是普通配置依赖，应按供应链软件治理。

## 3. 安装和版本固定

通过官方发行渠道或组织制品库安装并核验校验和：

```bash
packer version
packer -help
packer plugins installed
```

模板中限制 Core 版本：

```hcl
packer {
  required_version = ">= 1.14, < 2.0"
}
```

版本范围只是示例，实际应根据受测版本制定。本地、CI 与应急重建必须使用相同 Packer 与 Plugin 组合，不能在构建时自动选择未知的最新版本。

## 4. Plugin 声明与安装

```hcl
packer {
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "~> 1.3"
    }
  }
}
```

```bash
packer init .
packer plugins required .
packer plugins installed
```

`packer init` 只处理 HCL 模板，不支持旧式 JSON 模板初始化。旧 JSON 应先评估并转换为 HCL，而不是长期维持两种模板模型。

根据官方当前说明，部分 HashiCorp 维护的 Plugin 自 2025 年 8 月起转移到 HashiCorp Release Site；Packer 1.14 及以上能处理新的官方分发来源。离线镜像和企业制品库需要同步调整，不能继续假设所有 Plugin 都从 GitHub Release 下载。

## 5. Plugin 可重复性边界

`required_plugins` 声明来源和版本约束，但 Packer 的插件锁定模型与 Terraform `.terraform.lock.hcl` 不同。组织需要额外保存：

- 最终安装的 Plugin 精确版本；
- 二进制 SHA256 和下载来源；
- OS/Architecture；
- Packer Core 版本；
- 构建容器或 Runner 镜像 Digest。

只有 `~> 1.3` 而不记录实际版本，无法证明几个月后重建使用了同一二进制。

## 6. Builder 与 Source 的关系

`source` 块定义一种构建输入，`build` 引用一个或多个 Source：

```hcl
source "amazon-ebs" "rocky" {
  region        = var.region
  instance_type = var.builder_instance_type
  source_ami    = var.base_ami_id
  ssh_username  = "rocky"
  ami_name      = local.image_name
}

build {
  name    = "linux-base"
  sources = ["source.amazon-ebs.rocky"]
}
```

同一个 Build 可以面向多个 Source，但不同平台的设备、Agent、Cloud-init、包仓库和启动语义可能不同。共享 Provisioner 前要明确哪些步骤真的跨平台一致。

## 7. Communicator 为什么经常是故障点

云 API 报告实例 Running，不代表 SSH/WinRM 已可用。完整链路包括：

```text
实例启动
→ 网络接口/路由/安全组
→ Guest 内核与 systemd
→ cloud-init/首次启动任务
→ SSH/WinRM 服务
→ 用户、密钥和认证
→ Packer Communicator
```

常见误区是把连接超时一律当作 SSH 配置错误。应同时查看云控制台日志、串口、Cloud-init 状态、路由和安全组。

构建机不应为了连接方便在公网开放 `0.0.0.0/0:22`。优先使用私网 Runner、临时安全组、会话代理或目标平台的私有连接能力。

## 8. 构建身份分离

至少区分：

```text
CI 身份：启动 Packer Job、读取代码和制品
Builder API 身份：创建临时实例/磁盘/镜像
Communicator 身份：登录临时 Guest
运行实例身份：新实例启动后从平台获取
```

Builder API 身份只允许在指定账号、网络和命名空间创建带 Build 标签的临时资源，并发布到候选镜像区域。不要把生产实例的长期 Role、SSH Key 或 Vault Token 固化进镜像。

## 9. 临时资源生命周期

Packer 会尽力清理，但进程崩溃、Runner 被终止、权限变化或云 API 超时仍可能留下：

- 构建实例；
- 临时磁盘、快照与网卡；
- 临时安全组、Key Pair、公网 IP；
- 未完成/不可用镜像；
- 本地 QEMU 磁盘和缓存。

所有临时对象应有唯一 Build ID、Owner、Commit、创建时间和 TTL 标签。清理任务先确认 Build 已终止，再按唯一 ID 删除；不得用模糊名称批量删除。

## 10. 日志与调试

Packer 支持调试日志和断点，但日志可能包含云 API、SSH、WinRM、脚本变量和路径。生产复现应：

1. 使用隔离账号和短期身份；
2. 最小化复现 Source/Provisioner；
3. 把日志写入受控文件；
4. 上传前脱敏；
5. 调试结束删除日志与临时资源。

`-debug` 会改变构建节奏并暂停步骤，不等价于正常自动化行为。

## 11. 最小执行闭环

```bash
packer fmt -check .
packer init .
packer validate .
packer inspect .
packer build -timestamp-ui .
```

之后还必须解析 Manifest、启动测试实例、执行安全/功能测试并晋级。不要直接把 `packer build` 的输出名称写入生产 Terraform。

## 12. 练习与答案

**问题：Packer Core 版本固定，是否足以保证镜像可重复？**

答案：不足。还要固定 Plugin、基础镜像 ID、软件仓库/包版本、Provisioner 依赖、构建网络和脚本 Commit，并记录实际产物元数据。

**问题：构建失败后为什么不能直接按名称删除所有 `packer-*` 实例？**

答案：名称可能与仍在运行的构建或其他团队冲突。应根据唯一 Build ID、Owner、任务状态和创建时间确认，再执行可审计清理。

参考资料：

- [Packer plugins](https://developer.hashicorp.com/packer/docs/plugins)
- [Packer init](https://developer.hashicorp.com/packer/docs/commands/init)
- [Packer required plugins](https://developer.hashicorp.com/packer/docs/templates/hcl_templates/blocks/packer)
