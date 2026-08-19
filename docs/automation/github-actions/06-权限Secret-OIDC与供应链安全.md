---
title: "GitHub Actions 权限、Secret、OIDC 与供应链安全"
sidebar_label: "06. 权限、OIDC 与供应链安全"
sidebar_position: 6
description: "围绕 GITHUB_TOKEN、Fork 事件、Environment Secret、OIDC 联合身份和第三方 Action 建立最小权限流水线。"
tags: [GitHub Actions, OIDC, GITHUB_TOKEN, Secret, 供应链安全]
---

# GitHub Actions 权限、Secret、OIDC 与供应链安全

## 1. 先画信任边界

```text
不可信：Fork PR、Issue 文本、分支名、外部 Action、构建依赖
受保护：默认分支 Workflow、Environment、OIDC 云 Role、发布 Runner
```

任何不可信输入进入高权限 Job 前必须经过代码合并、审批或严格验证。

## 2. `GITHUB_TOKEN`

令牌通常按 Run/Job 下发，权限由仓库默认值与 `permissions` 共同决定。工作流和 Job 层显式声明最小权限，例如测试只需 `contents: read`，不要默认获得写仓库、发布包或申请 OIDC Token 的能力。

权限提升拆成独立 Job，依赖已验证的不可变 Artifact，并绑定受保护 Environment。

## 3. 危险事件组合

`pull_request_target` 在目标仓库上下文运行，可能获得更高权限。若它 Checkout 并执行 Fork 中的代码，攻击者可能读取 Secret 或控制仓库。安全用途应限制为标签、评论等不执行 PR 代码的元数据操作；测试不可信代码使用低权限 `pull_request`。

## 4. OIDC 联合身份

```text
Job 申请 GitHub OIDC Token
→ 云 IAM 验证 Issuer、Audience 与 Subject/Claim
→ 返回短期云凭据
→ Job 访问限定资源
```

云端 Trust Policy 必须绑定组织、仓库、分支/Environment 和用途，不能只验证“来自 GitHub”。仅需要云访问的 Job 才授予 `id-token: write`。

OIDC 减少长期 Access Key，但不能消除恶意工作流滥用短期身份的风险。

## 5. 第三方 Action

- 固定完整 Commit SHA，并审查源代码和依赖；
- 限制 Action 可获得的 Token、Secret、网络和工作目录；
- 使用依赖更新 PR 评审新 SHA；
- 高敏发布可使用内部镜像/复刻和允许列表；
- 不把 Action 的 Tag、星标或 Marketplace 标识当安全证明。

## 6. Secret 治理

优先 OIDC 和 Vault 动态凭据。必须使用 Secret 时按组织、仓库、Environment 最小作用域保存，定期轮换并验证撤销。掩码是降低误显示，不是防泄漏边界；恶意代码能编码、分片或上传 Secret。

## 7. 官方资料

- [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [OIDC in cloud providers](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
