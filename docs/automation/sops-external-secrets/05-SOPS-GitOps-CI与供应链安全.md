---
title: "SOPS GitOps、CI 与供应链安全"
sidebar_label: "05. SOPS GitOps 与 CI"
sidebar_position: 5
description: "设计密文仓库、CI 解密身份、GitOps 控制器、日志缓存和供应链边界，避免明文扩散。"
tags: [SOPS, GitOps, CI/CD, Supply Chain, Security]
---

# SOPS GitOps、CI 与供应链安全

## 1. 两种解密位置

| 位置 | 优点 | 风险 |
| --- | --- | --- |
| CI 渲染时 | 门禁和部署流程统一 | Runner 可见明文，日志/缓存/制品风险 |
| GitOps 控制器端 | 明文不经过普通 CI | 控制器身份和集群权限高度敏感 |

选择后明确谁能修改密文、谁能调用 KMS、谁能部署，以及明文在哪里存在多久。

## 2. CI 安全链

```text
受保护分支/Environment
→ OIDC 获取短期 KMS 权限
→ 拉取固定版本 SOPS
→ 在内存/受限临时目录解密
→ 渲染与部署
→ 清理文件和子进程
→ 撤销短期身份
```

Fork PR 不获得解密权限。PR 可验证密文格式、接收者和非敏感 Schema，但不能运行能打印明文的自定义代码。

## 3. 工具供应链

固定 SOPS 和 GitOps 插件版本，校验发布签名/摘要，限制下载来源。恶意或被替换的解密工具能直接窃取全部明文，保护级别应与密钥相同。

## 4. 明文传播点

- Shell `set -x`、错误栈和命令参数；
- 临时文件、编辑器 Swap、Core Dump；
- CI Cache/Artifact、容器层和 Docker Build Context；
- 渲染后的 YAML、差异输出和通知；
- Kubernetes Event、应用日志和诊断包。

掩码不能识别所有编码和分片形式，应从流程上避免输出。

## 5. 回滚语义

Git 回滚密文文件可能恢复旧密码，但目标系统可能已撤销旧值。Secret 版本和应用配置版本需要兼容窗口与发布顺序，不能假设 `git revert` 自动恢复认证。

## 6. 审计

关联 Git Commit、审批、SOPS 接收者变更、KMS Decrypt 日志、CI Run 和部署记录。异常的大量解密、非发布时段解密或新身份访问应告警。
