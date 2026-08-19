---
title: "Rundeck 从零到精通学习路线"
sidebar_label: "00. Rundeck 学习路线"
sidebar_position: 0
description: "从节点、项目和 Job 开始，掌握工作流、调度、远程执行、ACL、Key Storage、插件、容量、HA 和安全自助运维。"
tags: [Rundeck, Runbook Automation, Job, SRE, 自动化, 学习路线]
---

# Rundeck 从零到精通学习路线

Rundeck 将人工 Runbook 变成参数化、受权限控制、可调度和可审计的 Job。它适合安全自助运维和跨系统操作编排，不替代 Ansible 的配置收敛、Argo Workflows 的 Kubernetes 批处理，也不替代 Temporal 的持久化业务工作流。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [定位、架构、部署与执行路径](./01-定位架构部署与执行路径.md) | 解释 Web/API 到节点执行链 |
| 2 | [Project、Node 与资源模型](./02-Project-Node与资源模型.md) | 建立动态节点目录和标签 |
| 3 | [Node Executor、File Copier 与远程执行](./03-NodeExecutor-FileCopier与远程执行.md) | 安全执行 SSH/WinRM/API 操作 |
| 4 | [Job、Workflow、Step、Option 与 Context](./04-Job-Workflow-Step-Option与Context.md) | 构建可复用参数化 Job |
| 5 | [Schedule、Webhook、API 与事件触发](./05-Schedule-Webhook-API与事件触发.md) | 接入定时和事件系统 |
| 6 | [重试、超时、并发、错误处理与幂等](./06-重试超时并发错误处理与幂等.md) | 控制部分失败与重复执行 |
| 7 | [认证、ACL、Key Storage 与审计](./07-认证ACL-KeyStorage与审计.md) | 建立最小权限和凭据边界 |
| 8 | [Ansible、Kubernetes、通知与插件集成](./08-Ansible-Kubernetes通知与插件集成.md) | 组合现有自动化技术栈 |
| 9 | [日志、指标、容量与故障排查](./09-日志指标容量与故障排查.md) | 运营大规模执行平台 |
| 10 | [高可用、备份、升级与灾难恢复](./10-高可用备份升级与灾难恢复.md) | 保护控制面和执行历史 |
| 11 | [生产自助运维综合项目](./11-生产自助运维综合项目.md) | 交付可审批、可回滚 Runbook |

## 2. 掌握标准

- [ ] 能区分 Project、Job、Workflow、Step、Node 和 Execution。
- [ ] Node Source 动态更新且不会误选生产目标。
- [ ] Option 经过允许列表验证，不直接拼接 Shell。
- [ ] 凭据位于受控 Key Storage/Vault，不出现在日志。
- [ ] 并发、超时、失败比例、重试和回滚语义明确。
- [ ] 高风险 Job 有审批、最小目标范围和完整审计。

## 3. 官方资料

- [Rundeck Documentation](https://docs.rundeck.com/docs/)
