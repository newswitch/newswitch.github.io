---
title: "GitHub Actions Cache、Artifact、Package 与 OCI 制品"
sidebar_label: "04. Cache、Artifact 与制品"
sidebar_position: 4
description: "区分依赖缓存、运行制品、软件包和 OCI 镜像，建立校验、保留、晋级与防缓存投毒策略。"
tags: [GitHub Actions, Cache, Artifact, Package, OCI]
---

# GitHub Actions Cache、Artifact、Package 与 OCI 制品

## 1. 四种数据用途

| 对象 | 目的 | 是否作为发布真相 |
| --- | --- | --- |
| Cache | 加速可重新生成的依赖/编译中间物 | 否 |
| Artifact | 在 Job/Run 间传报告和候选产物 | 候选，不应只依赖名称 |
| Package | 发布语言包或通用包 | 是，需要版本与权限 |
| OCI Registry | 保存镜像、SBOM、签名和证明 | 是，按 Digest |

Cache 命中失败只应变慢，不能让构建无法重现。

## 2. Cache Key

Key 包含操作系统、架构、工具链和锁文件摘要。Restore Key 放宽匹配会提高命中，也增加不兼容或投毒风险。Fork 和非保护分支不能向生产信任域写入可执行缓存。

缓存恢复后仍验证包锁、校验和和来源。敏感配置、Token、签名私钥和完整工作目录不得缓存。

## 3. Artifact 完整性

上传前生成 Manifest：文件列表、大小、SHA-256、源码 SHA、构建命令和工具版本。下游下载后验证，再使用。不要只用可预测名称 `app.zip` 判断来源。

不同 Job 默认不共享文件系统，必须显式上传/下载 Artifact 或从可信 Registry 获取。

## 4. OCI 构建与发布

```text
源码 SHA
→ 可重现构建
→ 镜像 Digest
→ SBOM/扫描/来源证明
→ 签名 Digest
→ Harbor 候选项目
→ 策略验证与晋级
→ 按 Digest 部署
```

登录 Harbor 使用 OIDC/短期凭据或受保护 Secret，不在命令行和日志打印密码。构建上下文排除 `.git` 中不必要文件、凭据和本地缓存。

## 5. 保留与容量

测试日志、临时 Artifact、正式发布包和审计证明使用不同保留期。清理前保护仍被部署和回滚窗口引用的 Digest。监控 Artifact/Cache 用量、上传下载耗时、命中率和 Registry 增长。
