---
title: "Packer 架构、安装、Plugin 与执行路径"
sidebar_label: "01. 架构、安装与 Plugin"
sidebar_position: 1
description: "理解 Packer Core、Plugin、Source、Builder、Communicator、Provisioner 和 Post-processor。"
tags: [Packer, Plugin, Builder, Provisioner, Architecture]
---

# Packer 架构、安装、Plugin 与执行路径

## 1. 组件

| 组件 | 职责 |
| --- | --- |
| Core/CLI | 解析模板、调度构建、输出 Manifest |
| Plugin | 提供 Builder、Data Source、Provisioner 等能力 |
| Source | 定义一种可复用构建来源 |
| Builder | 创建并产出特定平台镜像 |
| Communicator | SSH/WinRM 连接临时实例 |
| Provisioner | 在实例中安装和配置 |
| Post-processor | 对产物做后续处理 |

## 2. 验证环境

```bash
packer version
packer -help
packer plugins installed
```

使用官方或组织制品库安装，保存 Hash。CI 固定版本。

## 3. Plugin 声明

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

示例版本仅说明语法。Plugin 以进程方式运行并继承构建权限，应像构建工具一样审查和锁定。

```bash
packer init .
packer plugins required .
```

## 4. 构建身份

权限只允许创建临时资源、读取指定基础镜像、生成/标记目标镜像和清理。不要给构建器账号管理员权限。

## 5. 临时资源

异常退出可能留下实例、磁盘、安全组和快照。使用唯一 Build ID/标签，设置成本告警和孤儿资源清理 Runbook。

## 6. 实验边界

先在隔离账号和专用网络构建；Communicator 不暴露到公网；日志和 Crash 文件按敏感数据处理。
