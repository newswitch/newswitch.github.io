---
title: "Jenkins、GitLab CI 与 GitHub Actions 对比迁移"
sidebar_label: "10. CI 平台对比与迁移"
sidebar_position: 10
description: "从控制面、Runner、权限、复用、制品和运营边界比较三种 CI 平台，并设计可回退迁移。"
tags: [GitHub Actions, Jenkins, GitLab CI, CI/CD, 迁移]
---

# Jenkins、GitLab CI 与 GitHub Actions 对比迁移

## 1. 不是语法替换

| 维度 | Jenkins | GitLab CI | GitHub Actions |
| --- | --- | --- | --- |
| 控制面 | 自主管理 Controller/插件 | GitLab 协调 Pipeline | GitHub 协调 Workflow |
| 执行面 | Agent | Runner/Executor | GitHub-hosted 或自托管 Runner |
| 配置 | Jenkinsfile/Shared Library | `.gitlab-ci.yml`/组件 | Workflow/Reusable Workflow/Action |
| 权限核心 | Jenkins 安全域/凭据 | 项目、保护变量、Token | `GITHUB_TOKEN`、Environment、OIDC |
| 主要运营风险 | 插件、Controller、Agent | Runner 与 GitLab 平台容量 | Action 供应链与自托管 Runner |

选择由代码托管、网络、合规、可扩展性和团队运营能力决定，不按 YAML 长短决定。

## 2. 迁移盘点

为每条流水线记录：触发器、输入、阶段 DAG、Agent 能力、凭据、Artifact、审批、外部系统、并发锁、超时、通知和回滚。识别隐藏在共享库、插件、Runner 镜像和手工节点配置中的行为。

## 3. 概念映射

```text
Jenkins Agent / GitLab Runner → GitHub Runner
Stage/Job                   → Job/Step（需重新划边界）
Shared Library/CI Component → Reusable Workflow/Action
Credentials/Variable       → Secret/OIDC/Environment
Archive Artifact           → Artifact/Package/OCI Registry
Milestone/Resource Group    → Concurrency + 外部锁
```

映射不代表语义相同，尤其是触发事件、Secret 可见性、取消和重试。

## 4. 双跑方法

1. 先迁移只读测试，输出结构化报告。
2. 同一提交在两平台执行，对比结果、耗时和制品 Digest。
3. 发布先用 Shadow/Dry Run，不写生产。
4. 切换一个低风险服务，保留旧流水线可回退。
5. 验证权限、审计、故障和灾备后分批迁移。
6. 最后撤销旧凭据、Runner 和 Webhook，保留审计证据。

## 5. 不应搬迁的内容

手工修复、长期静态云密钥、长驻 Runner 漂移、重复构建发布制品和无界重试不应原样复制。迁移是重建信任和制品边界的机会。
