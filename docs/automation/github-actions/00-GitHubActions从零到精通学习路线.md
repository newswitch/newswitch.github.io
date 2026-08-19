---
title: "GitHub Actions 从零到精通学习路线"
sidebar_label: "00. GitHub Actions 学习路线"
sidebar_position: 0
description: "从 Workflow、Job、Runner 与 Action 开始，掌握权限、OIDC、复用、制品、发布、容量、排障和生产交付。"
tags: [GitHub Actions, CI/CD, Runner, DevOps, 自动化, 学习路线]
---

# GitHub Actions 从零到精通学习路线

GitHub Actions 将仓库事件转换为 Workflow Run，由 GitHub 调度 Job 到 Runner，Runner 再按顺序执行 Step。工作流文件既是自动化代码，也是权限边界：能修改它的人可能借助令牌、Secret、Runner 和部署权限影响外部系统。

## 1. 学习顺序

| 阶段 | 文章 | 完成后能做什么 |
| --- | --- | --- |
| 1 | [架构、事件与执行路径](./01-架构事件与执行路径.md) | 解释事件到 Runner 的完整链路 |
| 2 | [Workflow 语法、Context 与表达式](./02-Workflow语法Context与表达式.md) | 编写边界明确的工作流 |
| 3 | [GitHub-hosted、自托管 Runner 与 ARC](./03-GitHubHosted自托管Runner与ARC.md) | 选择并运营隔离执行环境 |
| 4 | [Cache、Artifact、Package 与 OCI 制品](./04-Cache-Artifact-Package与OCI制品.md) | 建立可追踪的制品链 |
| 5 | [复用工作流、Composite 与自定义 Action](./05-复用工作流Composite与自定义Action.md) | 建立受控平台模板 |
| 6 | [权限、Secret、OIDC 与供应链安全](./06-权限Secret-OIDC与供应链安全.md) | 避免长期云密钥和不可信代码越权 |
| 7 | [Environment、审批与渐进式发布](./07-Environment审批与渐进式发布.md) | 管理生产发布和回滚 |
| 8 | [Matrix、并发、取消与可靠性](./08-Matrix并发取消与可靠性.md) | 控制大型工作流的失败和资源 |
| 9 | [日志、指标、成本与故障排查](./09-日志指标成本与故障排查.md) | 定位排队、Runner 和 Job 故障 |
| 10 | [Jenkins、GitLab CI 与 GitHub Actions 对比迁移](./10-Jenkins-GitLabCI与GitHubActions对比迁移.md) | 按边界选择平台并安全迁移 |
| 11 | [生产交付综合项目](./11-生产交付综合项目.md) | 串联测试、Harbor、OIDC、审批和 GitOps |

## 2. 掌握标准

- [ ] 能区分 Workflow、Run、Job、Step、Action 和 Runner。
- [ ] 能解释 `pull_request` 与 `pull_request_target` 的信任差异。
- [ ] `GITHUB_TOKEN` 使用显式最小权限，Fork 代码不能读取生产 Secret。
- [ ] 第三方 Action 固定到经过审查的不可变提交。
- [ ] Cache 不承担制品发布，生产部署记录 OCI Digest。
- [ ] 自托管 Runner 不在不可信任务之间残留工作区和凭据。
- [ ] Workflow 有并发、超时、取消、重试和部署回滚边界。

## 3. 官方资料

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workflow Syntax](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)
