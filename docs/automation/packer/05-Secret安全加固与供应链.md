---
title: "Packer Secret、安全加固与供应链"
sidebar_label: "05. Secret、安全与供应链"
sidebar_position: 5
description: "治理构建凭据、镜像内 Secret、基础镜像来源、包仓库、扫描、SBOM、签名与构建隔离。"
tags: [Packer, Secret, Hardening, SBOM, Supply Chain]
---

# Packer Secret、安全加固与供应链

## 1. 三类身份

- 构建平台身份：创建临时资源和镜像。
- Provisioner 身份：连接临时实例。
- 运行实例身份：由实例启动时获取。

三者不共享长期凭据。

## 2. Secret 禁止落入镜像

构建结束前检查环境文件、Shell History、日志、缓存、临时目录、SSH Key、云凭据和 CI 工作区。删除文件不保证它未进入快照早期层或日志，设计上避免写入。

## 3. 基础与软件来源

固定发布者、镜像 ID、包仓库、GPG/签名和 Hash。第三方脚本先下载校验再执行，不使用 `curl | sh` 作为生产构建链。

## 4. 加固

应用组织基线、最小服务、文件权限、审计和防火墙，同时保留可运维性。关闭 SSH 或网络前确保云 Agent、控制台和启动路径可用。

## 5. 扫描与 SBOM

扫描 OS 包、语言依赖、配置和已知漏洞；生成 SBOM 与镜像 Manifest。扫描时间与漏洞数据库版本进入证据。

## 6. 签名和晋级

签名构建 Manifest/镜像能力，环境按不可变 ID 晋级。生产账号不重新构建相同版本，而是复制或发布经过验证的同一产物。
