---
title: "Jenkins 从零到精通学习路线"
sidebar_label: "00. Jenkins 学习路线"
sidebar_position: 0
description: "从 Controller、Agent、Queue 和 Executor 开始，掌握 Pipeline、安全、凭据、动态 Agent、制品、共享库、可靠性、升级与综合交付。"
tags: [Jenkins, CI/CD, Pipeline, DevOps, 自动化, 学习路线]
---

# Jenkins 从零到精通学习路线

Jenkins 是可扩展的自动化控制面。成熟使用方式不是在 Controller 上堆自由式任务，而是把 Pipeline、Agent 镜像、插件、凭据、配置和恢复流程都版本化。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [架构、部署与执行路径](./01-架构部署与执行路径.md) | 解释 Controller、Queue、Agent 和 Executor |
| 2 | [安全域、RBAC、凭据与审计](./02-安全域RBAC凭据与审计.md) | 建立身份和不可信代码边界 |
| 3 | [Jenkinsfile、Declarative 与 Scripted Pipeline](./03-Jenkinsfile-Declarative与ScriptedPipeline.md) | 编写可审查流水线 |
| 4 | [Agent、Docker 与 Kubernetes 动态执行](./04-Agent-Docker与Kubernetes动态执行.md) | 隔离并弹性运行任务 |
| 5 | [Workspace、Cache、Artifact 与制品](./05-Workspace-Cache-Artifact与制品.md) | 区分临时工作区和不可变制品 |
| 6 | [Shared Library、模板与平台接口](./06-SharedLibrary模板与平台接口.md) | 治理复用和升级兼容 |
| 7 | [并发、锁、超时、重试与可靠性](./07-并发锁超时重试与可靠性.md) | 控制资源和失败扩散 |
| 8 | [日志、指标、容量与故障排查](./08-日志指标容量与故障排查.md) | 分层定位 Queue、Agent 和 Pipeline |
| 9 | [插件、升级、备份与灾难恢复](./09-插件升级备份与灾难恢复.md) | 安全维护 Controller |
| 10 | [生产自动化流水线综合项目](./10-生产自动化流水线综合项目.md) | 串联 Git、测试、制品、审批和发布 |

## 2. 主路径

```text
Webhook/Timer/User
→ Controller 创建 Queue Item
→ 根据 Label/权限/资源选择 Agent Executor
→ 获取源码和执行 Pipeline Step
→ 上传制品与结果
→ 审批后部署
→ Controller 保存构建元数据和审计
```

## 3. 掌握标准

- [ ] Controller 不执行普通构建。
- [ ] Pipeline、Shared Library、JCasC 和 Agent 镜像版本化。
- [ ] 不可信 PR 无法读取生产凭据。
- [ ] Workspace/Cache 不被当作发布制品。
- [ ] Queue、Executor、并发、锁、Timeout 和重试有上限。
- [ ] 插件升级、备份、恢复和回滚经过演练。

## 4. 官方资料

- [Jenkins Documentation](https://www.jenkins.io/doc/)
