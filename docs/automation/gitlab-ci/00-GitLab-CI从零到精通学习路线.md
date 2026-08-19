---
title: "GitLab CI 从零到精通学习路线"
sidebar_label: "00. GitLab CI 学习路线"
sidebar_position: 0
description: "从 Pipeline、Job、Runner 和 Executor 开始，掌握规则、DAG、制品、环境、安全、性能、排障和生产交付。"
tags: [GitLab CI, Runner, CI/CD, DevOps, 自动化, 学习路线]
---

# GitLab CI 从零到精通学习路线

GitLab CI 将仓库事件转换为 Pipeline，由 GitLab 协调 Job，Runner 领取并在 Executor 中执行。`.gitlab-ci.yml` 是可执行代码，能修改它的人可能影响凭据和发布权限。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [架构、Pipeline、Job 与 Runner](./01-架构Pipeline-Job与Runner.md) | 解释任务从提交到 Executor 的路径 |
| 2 | [YAML、Stage、Rule 与变量](./02-YAML-Stage-Rule与变量.md) | 设计可预测的创建和运行条件 |
| 3 | [Needs、DAG、Child 与多项目流水线](./03-Needs-DAG-Child与多项目流水线.md) | 编排大型流水线依赖 |
| 4 | [Runner、Executor、Docker 与 Kubernetes](./04-Runner-Executor-Docker与Kubernetes.md) | 隔离并弹性运行 Job |
| 5 | [Cache、Artifact、Package 与镜像](./05-Cache-Artifact-Package与镜像.md) | 建立不可变制品链 |
| 6 | [Environment、Review App、审批与发布](./06-Environment-ReviewApp审批与发布.md) | 管理环境和渐进式交付 |
| 7 | [Token、OIDC、Secret 与供应链安全](./07-Token-OIDC-Secret与供应链安全.md) | 隔离不可信 Pipeline 与发布身份 |
| 8 | [并发、容量、日志与故障排查](./08-并发容量日志与故障排查.md) | 定位 Pending、Runner 和 Job 故障 |
| 9 | [模板、组件、版本与治理](./09-模板组件版本与治理.md) | 复用受控流水线能力 |
| 10 | [生产交付综合项目](./10-生产交付综合项目.md) | 串联构建、Harbor、审批和发布 |

## 2. 掌握标准

- [ ] `workflow:rules` 与 Job `rules` 不产生重复 Pipeline。
- [ ] Runner 信任级别、Tag、Executor 和网络隔离明确。
- [ ] Cache 不被当制品，生产部署按 Digest。
- [ ] Fork/非保护分支无法获得保护变量。
- [ ] Pipeline DAG、并发、资源组和重试有上限。
- [ ] 模板和组件固定版本，升级有兼容测试。

## 3. 官方资料

- [GitLab CI/CD Documentation](https://docs.gitlab.com/ci/)
- [GitLab Runner Documentation](https://docs.gitlab.com/runner/)
